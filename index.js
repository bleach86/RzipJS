import pako from "pako";

// Values for RZIP format from RetroArch's rzip_stream.c
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
    this.rfile = rfile;
    this.header = this.read_header();
  }

  // Reads the RZIP header from the given rfile Uint8Array
  read_header() {
    const header_bytes = this.rfile.slice(0, RZIP_HEADER_SIZE);

    if (
      this.rfile.length < RZIP_HEADER_SIZE ||
      !array_equal(header_bytes.slice(0, RZIP_MAGIC.length), RZIP_MAGIC)
    ) {
      // Invalid RZIP file, treat as uncompressed
      return new RzipHeader(this.rfile.length, RZIP_DEFAULT_CHUNK_SIZE, false);
    }

    // Read chunk size (4 bytes, little-endian)
    const chunk_size = new DataView(header_bytes.buffer).getUint32(
      RZIP_MAGIC.length,
      true
    );

    if (chunk_size <= 0) {
      throw new Error("Invalid RZIP chunk size");
    }

    // Read inflated size (8 bytes, little-endian)
    const inflated_size = new DataView(header_bytes.buffer).getBigUint64(
      RZIP_MAGIC.length + 4,
      true
    );
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

    let inflated_data = new Uint8Array(Number(this.header.inflated_size));
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

      const compressed_chunk_size = new DataView(chunk_header.buffer).getUint32(
        0,
        true
      );

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

    if (inflated_data.length !== Number(this.header.inflated_size)) {
      throw new Error(
        "Decompressed size does not match expected inflated size"
      );
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

    let rzip_data = new Uint8Array(this.rfile.length); // Allocate more than enough space

    // Write RZIP header
    const header = new Uint8Array(RZIP_HEADER_SIZE);
    header.set(RZIP_MAGIC, 0);

    // Chunk size, 4 bytes, little-endian
    const chunk_size = new DataView(new ArrayBuffer(4));
    chunk_size.setUint32(0, RZIP_DEFAULT_CHUNK_SIZE, true);

    // Inflated size, 8 bytes, little-endian
    const inflated_size = BigInt(this.rfile.length);
    const inflated_size_view = new DataView(new ArrayBuffer(8));
    inflated_size_view.setBigUint64(0, inflated_size, true);

    header.set(new Uint8Array(chunk_size.buffer), RZIP_MAGIC.length);
    header.set(
      new Uint8Array(inflated_size_view.buffer),
      RZIP_MAGIC.length + 4
    );

    rzip_data.set(header, 0);

    // Compress and write chunks
    let offset = 0;
    let compressed_offset = RZIP_HEADER_SIZE;

    while (offset < this.rfile.length) {
      const chunk = this.rfile.slice(
        offset,
        Math.min(offset + RZIP_DEFAULT_CHUNK_SIZE, this.rfile.length)
      );
      offset += chunk.length;

      const compressed_chunk = this.pako.deflate(chunk, {
        level: RZIP_COMPRESSION_LEVEL,
      });

      const chunk_header = new Uint8Array(RZIP_CHUNK_HEADER_SIZE);
      const compressed_chunk_size_view = new DataView(new ArrayBuffer(4));
      compressed_chunk_size_view.setUint32(0, compressed_chunk.length, true);

      chunk_header.set(new Uint8Array(compressed_chunk_size_view.buffer), 0);

      const next_data_length = RZIP_CHUNK_HEADER_SIZE + compressed_chunk.length;
      if (compressed_offset + next_data_length > rzip_data.length) {
        // Resize rzip_data
        // Extend by the remaining unprocessed data + next_data_length * 2
        const new_rzip_data = new Uint8Array(
          this.rfile.length - compressed_offset + next_data_length * 2
        );
        new_rzip_data.set(rzip_data, 0);
        rzip_data = new_rzip_data;
      }

      rzip_data.set(chunk_header, compressed_offset);
      compressed_offset += RZIP_CHUNK_HEADER_SIZE;

      rzip_data.set(compressed_chunk, compressed_offset);
      compressed_offset += compressed_chunk.length;
    }

    // truncate rzip_data to actual size
    rzip_data = rzip_data.slice(0, compressed_offset);
    this.rfile = rzip_data;
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
