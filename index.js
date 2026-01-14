import pako from "pako";

const RZIP_VERSION = 1;
const RZIP_COMPRESSION_LEVEL = 6;
const RZIP_DEFAULT_CHUNK_SIZE = 131072; // 128kb
const RZIP_HEADER_SIZE = 20;
const RZIP_CHUNK_HEADER_SIZE = 4;

const RZIP_MAGIC = Uint8Array.from([35, 82, 90, 73, 80, 118, RZIP_VERSION, 35]); // "#RZIPv1#"

class RzipHeader {
  constructor(inflated_size, chunk_size, is_rzip_compressed) {
    this.chunk_size = chunk_size;
    this.inflated_size = inflated_size;
    this.is_rzip_compressed = is_rzip_compressed;
  }
}

class RzipJS {
  // rfile: Uint8Array
  constructor(rfile) {
    this.pako = pako;
    this.rfile = Uint8Array.from(rfile);
    this.header = this.read_header(this.rfile);
  }

  // Reads the RZIP header from the given rfile Uint8Array
  read_header(rfile) {
    const header_bytes = rfile.slice(0, 20);

    if (
      header_bytes.length < RZIP_HEADER_SIZE ||
      !array_equal(header_bytes.slice(0, RZIP_MAGIC.length), RZIP_MAGIC)
    ) {
      // Invalid RZIP file, treat as uncompressed
      return new RzipHeader(rfile.length, RZIP_DEFAULT_CHUNK_SIZE, false);
    }

    // Read chunk size (4 bytes, little-endian)
    const chunk_size =
      (header_bytes[8] |
        (header_bytes[9] << 8) |
        (header_bytes[10] << 16) |
        (header_bytes[11] << 24)) >>>
      0;

    if (chunk_size <= 0) {
      throw new Error("Invalid RZIP chunk size");
    }

    // Read inflated size (8 bytes, little-endian)
    const inflated_size =
      (header_bytes[12] |
        (header_bytes[13] << 8) |
        (header_bytes[14] << 16) |
        (header_bytes[15] << 24) |
        (header_bytes[16] << 32) |
        (header_bytes[17] << 40) |
        (header_bytes[18] << 48) |
        (header_bytes[19] << 56)) >>>
      0;
    if (inflated_size <= 0) {
      throw new Error("Invalid RZIP inflated size");
    }

    return new RzipHeader(inflated_size, chunk_size, true);
  }

  // Returns true if the rfile is RZIP compressed
  is_rzip_compressed() {
    return this.header.is_rzip_compressed;
  }

  // Decompresses the RZIP compressed rfile
  rzip_inflate() {
    if (!this.is_rzip_compressed()) {
      return this.rfile;
    }

    let inflated_data = new Uint8Array(this.header.inflated_size);
    let inflated_offset = 0;
    let rfile_offset = RZIP_HEADER_SIZE;

    while (inflated_offset < this.header.inflated_size) {
      if (rfile_offset + RZIP_CHUNK_HEADER_SIZE > this.rfile.length) {
        throw new Error(
          "Unexpected end of RZIP file while reading chunk header"
        );
      }

      const chunk_header = this.rfile.slice(
        rfile_offset,
        rfile_offset + RZIP_CHUNK_HEADER_SIZE
      );
      rfile_offset += RZIP_CHUNK_HEADER_SIZE;

      const compressed_chunk_size =
        (chunk_header[0] |
          (chunk_header[1] << 8) |
          (chunk_header[2] << 16) |
          (chunk_header[3] << 24)) >>>
        0;

      if (rfile_offset + compressed_chunk_size > this.rfile.length) {
        throw new Error("Unexpected end of RZIP file while reading chunk data");
      }

      const compressed_chunk = this.rfile.slice(
        rfile_offset,
        rfile_offset + compressed_chunk_size
      );
      rfile_offset += compressed_chunk_size;

      const decompressed_chunk = this.pako.inflate(compressed_chunk);

      inflated_data.set(decompressed_chunk, inflated_offset);
      inflated_offset += decompressed_chunk.length;
    }

    this.rfile = inflated_data;
    this.header.is_rzip_compressed = false;

    return inflated_data;
  }

  // Compresses the rfile using RZIP compression
  rzip_deflate() {
    if (this.is_rzip_compressed()) {
      return this.rfile;
    }

    let rzip_data = [];

    // Write RZIP header
    const header = new Uint8Array(RZIP_HEADER_SIZE);
    header.set(RZIP_MAGIC, 0);

    // Chunk size, 4 bytes, little-endian
    header[8] = this.header.chunk_size & 0xff;
    header[9] = (this.header.chunk_size >> 8) & 0xff;
    header[10] = (this.header.chunk_size >> 16) & 0xff;
    header[11] = (this.header.chunk_size >> 24) & 0xff;

    // Inflated size, 8 bytes, little-endian
    const inflated_size = this.rfile.length;
    header[12] = inflated_size & 0xff;
    header[13] = (inflated_size >> 8) & 0xff;
    header[14] = (inflated_size >> 16) & 0xff;
    header[15] = (inflated_size >> 24) & 0xff;
    header[16] = (inflated_size >> 32) & 0xff;
    header[17] = (inflated_size >> 40) & 0xff;
    header[18] = (inflated_size >> 48) & 0xff;
    header[19] = (inflated_size >> 56) & 0xff;

    rzip_data.push(...header);

    // Compress and write chunks
    let offset = 0;
    while (offset < this.rfile.length) {
      const chunk = this.rfile.slice(
        offset,
        Math.min(offset + this.header.chunk_size, this.rfile.length)
      );
      offset += chunk.length;

      const compressed_chunk = this.pako.deflate(chunk, {
        level: RZIP_COMPRESSION_LEVEL,
      });

      const chunk_header = new Uint8Array(RZIP_CHUNK_HEADER_SIZE);
      const compressed_chunk_size = compressed_chunk.length;
      chunk_header[0] = compressed_chunk_size & 0xff;
      chunk_header[1] = (compressed_chunk_size >> 8) & 0xff;
      chunk_header[2] = (compressed_chunk_size >> 16) & 0xff;
      chunk_header[3] = (compressed_chunk_size >> 24) & 0xff;

      rzip_data.push(...chunk_header);
      rzip_data.push(...compressed_chunk);
    }

    this.rfile = Uint8Array.from(rzip_data);
    this.header.is_rzip_compressed = true;

    return this.rfile;
  }
}

function array_equal(a, b) {
  if (a.length !== b.length) {
    return false;
  }
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

export { RzipJS };
