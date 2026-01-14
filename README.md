# RzipJS

A JavaScript implementation of RetroArch's RZIP compression algorithm.

## Installation

```bash
npm install github:bleach86/RzipJS
```

## Usage

```javascript
import { RzipJS } from "RzipJS";

function main() {
  // Create RzipJS instance with Uint8Array data
  const rzip = new RzipJS(rzipData);

  // Check if data is RZIP compressed
  if (rzip.is_rzip_compressed()) {
    console.log("Data is RZIP compressed.");
  }

  // Inflate RZIP Compressed data
  // Returns Uint8Array of inflated data
  const inflatedData = rzip.rzip_inflate();

  // Compressed data in RZIP format
  // Returns Uint8Array of deflated data
  const deflatedData = rzip.rzip_deflate();
}
```

## License

This project is licensed under the GPL-3.0-or-later License.
See the [LICENSE](LICENSE) file for details.
