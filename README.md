# iPhone Photo Bridge

Direct iPhone to Linux photo backup via WebDAV - supports all iPhone formats with full metadata preservation.

![iPhone Photo Bridge](https://img.shields.io/badge/Platform-Linux-blue)
![License](https://img.shields.io/badge/License-MIT-green)

## Features

- **WebDAV Server** - Native WebDAV server compatible with iPhone Files app
- **All Formats Supported** - HEIC, HEIF, JPEG, PNG, RAW/DNG, ProRAW, Live Photos
- **Metadata Preservation** - EXIF data, GPS coordinates, dates, camera info kept intact
- **Local Network Only** - Your photos never leave your network
- **Auto-Organization** - Automatic date-based folder structure
- **Real-time Dashboard** - Monitor uploads, connections, and storage
- **QR Code Connection** - Easy iPhone connection via QR code

## Requirements

- Node.js 18+
- Linux system
- iPhone/iPad with iOS 13+

## Installation

```bash
# Clone the repository
git clone https://github.com/unn-Known1/iphone-photo-bridge.git
cd iphone-photo-bridge

# Install dependencies
npm install

# Start the server
npm start
```

## Usage

### 1. Start the Server

```bash
npm start
```

The server will start on port 3000 and display:
- Server URL (e.g., `http://192.168.1.100:3000`)
- Instructions for connecting

### 2. Connect iPhone

1. Open the **Files** app on your iPhone
2. Tap **"..."** or **"+"** button
3. Select **"Connect to Server"**
4. Enter the server URL shown in the terminal
5. Navigate to the Photos folder

### 3. Backup Photos

- Select photos in the Files app
- Tap **Copy** or **Move**
- Navigate to the iPhone Photo Bridge server location
- Paste to upload

## Configuration

Edit `package.json` or create environment variables:

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | 3000 | Server port |
| `BACKUP_PATH` | `~/iPhonePhotoBridge/Backups` | Backup location |

### Example:

```bash
PORT=8080 BACKUP_PATH=/media/photos npm start
```

## Web Interface

Open the server URL in a browser to access:
- Server control panel
- Real-time upload queue
- Photo gallery view
- Settings configuration

## Project Structure

```
iphone-photo-bridge/
├── server/
│   ├── main.js       # Main server with WebDAV + API
│   └── webdav.js     # WebDAV protocol handler
├── public/
│   └── index.html    # Web interface
├── package.json
└── SPEC.md          # Detailed specification
```

## Supported Formats

| Format | Extension | Support |
|--------|-----------|---------|
| HEIC | .heic, .heif | Full |
| JPEG | .jpg, .jpeg | Full |
| PNG | .png | Full |
| RAW/DNG | .dng, .raw | Full |
| ProRAW | .dng | Full |
| Live Photos | .mov + .jpg | Bundled |

## Security

- Local network only - no cloud exposure
- Optional Basic Auth available
- No data leaves your network

## License

MIT License - See LICENSE file for details

## Contributing

Contributions welcome! Please open an issue or submit a pull request.
