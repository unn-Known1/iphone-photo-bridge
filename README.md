# iPhone Photo Bridge

Direct iPhone to Linux photo backup via WebDAV with HTTPS support - compatible with all iPhone formats and full metadata preservation.

![iPhone Photo Bridge](https://img.shields.io/badge/Platform-Linux-blue)
![License](https://img.shields.io/badge/License-MIT-green)

## Features

- **HTTPS WebDAV Server** - iOS 13+ requires HTTPS for Files app connection
- **All Formats Supported** - HEIC, HEIF, JPEG, PNG, RAW/DNG, ProRAW, Live Photos
- **Metadata Preservation** - EXIF data, GPS coordinates, dates, camera info kept intact
- **Local Network Only** - Your photos never leave your network
- **Auto-Organization** - Automatic date-based folder structure
- **Real-time Dashboard** - Monitor uploads, connections, and storage
- **QR Code Connection** - Easy iPhone connection via QR code
- **Auto-Generated SSL** - Self-signed certificates for HTTPS (iOS compatible)

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

## Quick Start (iOS Files App)

### Step 1: Start the Server

```bash
npm start
```

The server will display:
```
Web Interface:  http://192.168.1.100:3000
WebDAV URL:     https://192.168.1.100:8080
```

### Step 2: Trust the SSL Certificate on iPhone

1. Open **Safari** on your iPhone
2. Go to: `https://YOUR_IP:3000` (replace with your actual IP)
3. Tap **Download Certificate**
4. Go to **Settings** > **General** > **VPN & Device Management**
5. Tap the certificate profile and tap **Install**
6. Enter your passcode and tap **Install** again
7. Go to **Settings** > **General** > **About** > **Certificate Trust Settings**
8. Enable full trust for the certificate

### Step 3: Connect via Files App

1. Open the **Files** app on your iPhone
2. Tap **...** (or **+** button)
3. Select **Connect to Server**
4. Enter: `https://YOUR_IP:8080` (e.g., `https://192.168.1.100:8080`)
5. Tap **Next** and accept the certificate if prompted
6. You should see the connected server

### Step 4: Backup Photos

- Navigate to your photos in the Files app
- Select photos you want to backup
- Tap **Copy** or **Move**
- Navigate to the connected iPhone Photo Bridge server
- Paste to upload

## Web Interface

Open `http://YOUR_IP:3000` in a browser to access:
- Server control panel with start/stop buttons
- Real-time upload monitoring
- Photo gallery view
- QR code for easy URL sharing
- Certificate download for iPhone setup

## Configuration

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | 3000 | Web interface port |
| `BACKUP_PATH` | `~/iPhonePhotoBridge/Backups` | Backup storage location |

### Example:

```bash
PORT=8080 BACKUP_PATH=/media/photos npm start
```

## Project Structure

```
iphone-photo-bridge/
├── server/
│   └── main.js       # WebDAV + HTTPS server with API
├── public/
│   └── index.html    # Web dashboard interface
├── package.json
└── README.md
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
| Video | .mov, .mp4 | Full |

## How It Works

1. **Server**: Node.js runs a WebDAV server with HTTPS support
2. **Certificate**: Auto-generates self-signed SSL certificate
3. **Connection**: iPhone connects via Files app using WebDAV protocol
4. **Transfer**: Photos are transferred over local network
5. **Storage**: Files saved to `~/iPhonePhotoBridge/Backups`
6. **Metadata**: JSON files created for each photo with full metadata

## Security

- **Local network only** - No cloud exposure
- **Self-signed HTTPS** - Required for iOS Files app
- **No internet required** - Works completely offline
- **Certificate-based** - Secure local transfer

## Troubleshooting

### "URL is not supported" Error
- Make sure you're using `https://` not `http://`
- Ensure the SSL certificate is trusted on your iPhone
- Check that you're entering the correct IP address

### Certificate Not Trusted
- Download the certificate from the web interface
- Install it in Settings > General > VPN & Device Management
- Enable full trust in Settings > General > About > Certificate Trust Settings

### Connection Refused
- Check if the server is running (look at the terminal)
- Ensure your firewall allows connections on port 8080
- Verify the IP address is correct

## License

MIT License - See LICENSE file for details

## Contributing

Contributions welcome! Please open an issue or submit a pull request.
