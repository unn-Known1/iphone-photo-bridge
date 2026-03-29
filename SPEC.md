# iPhone Photo Bridge - Specification

## 1. Project Overview

**Project Name**: iPhone Photo Bridge
**Type**: Cross-platform Desktop/Web Application (Linux-focused)
**Core Functionality**: A local network bridge that enables direct iPhone-to-Linux photo backup via WebDAV, preserving all metadata and supporting all iPhone photo formats.
**Target Users**: Linux users who want to backup photos from their iPhone without cloud services or iTunes.

## 2. Technical Architecture

### Core Components
1. **WebDAV Server** - Native Node.js WebDAV server for iPhone Files app connection
2. **Metadata Engine** - EXIF/XMP/IPTC metadata extraction and preservation
3. **Format Handler** - Support for HEIC, HEIF, JPEG, PNG, RAW (DNG), ProRAW, Live Photos
4. **Photo Organizer** - Automatic organization by date, location, album
5. **Dashboard** - Real-time monitoring of backup status

### Supported Formats
| Format | Extension | Support Level |
|--------|-----------|---------------|
| HEIC/HEIF | .heic, .heif | Full with conversion |
| JPEG | .jpg, .jpeg | Full |
| PNG | .png | Full |
| RAW/DNG | .dng, .raw | Full metadata preservation |
| ProRAW | .dng | Full |
| Live Photos | .mov + .jpg | Bundled |

## 3. UI/UX Specification

### Layout Structure
- **Single Page Application** with tabbed navigation
- **Sidebar**: Server controls, connection status, settings
- **Main Content**: Photo gallery, upload queue, backup statistics
- **Header**: App title, network info, quick actions

### Visual Design

#### Color Palette
- **Background Dark**: #0f0f0f (deep charcoal)
- **Background Card**: #1a1a1a (elevated surface)
- **Primary Accent**: #6366f1 (indigo - actions)
- **Secondary Accent**: #22d3ee (cyan - status)
- **Success**: #10b981 (emerald)
- **Warning**: #f59e0b (amber)
- **Error**: #ef4444 (red)
- **Text Primary**: #f8fafc (near white)
- **Text Secondary**: #94a3b8 (muted slate)
- **Border**: #2d2d2d (subtle)

#### Typography
- **Font Family**: "Inter", system-ui, sans-serif
- **Headings**:
  - H1: 28px, 700 weight
  - H2: 22px, 600 weight
  - H3: 18px, 600 weight
- **Body**: 14px, 400 weight
- **Small/Labels**: 12px, 500 weight

#### Spacing System
- Base unit: 4px
- Padding: 16px (cards), 24px (sections)
- Gap: 12px (grid items), 16px (sections)
- Border radius: 12px (cards), 8px (buttons), 6px (inputs)

#### Visual Effects
- Card shadows: 0 4px 20px rgba(0,0,0,0.3)
- Hover transitions: 200ms ease-out
- Status pulse animation for active server
- Progress bars with gradient fill

### Components

#### Server Control Panel
- Large toggle button for WebDAV server
- Connection URL display (with copy button)
- QR code for easy iPhone connection
- Active client count indicator
- Port configuration (default: 8080)

#### Photo Grid
- Masonry layout for varied aspect ratios
- Thumbnail with lazy loading
- Metadata overlay on hover (date, size, format)
- Selection mode for batch operations
- Virtual scrolling for large libraries

#### Upload Queue
- Real-time progress bars per file
- Status icons (pending, uploading, complete, error)
- Cancel/retry buttons
- Auto-scroll to latest

#### Statistics Dashboard
- Total photos backed up
- Storage used
- Backup by date chart
- Format distribution pie chart
- Last backup timestamp

## 4. Functionality Specification

### Core Features

#### F1: WebDAV Server
- Start/stop server with single click
- Auto-detect local IP address
- Configurable port (1024-65535)
- Optional authentication (username/password)
- Real-time connection monitoring
- SSL/TLS support for secure connections

#### F2: iPhone Connection Guide
- Step-by-step instructions with screenshots
- Animated guide showing Files app navigation
- Connection test functionality
- Troubleshooting tips

#### F3: Photo Upload Handling
- Accept uploads via WebDAV protocol
- Preserve original filenames
- Handle HEIC → JPEG conversion option
- Live Photo video extraction
- Burst photo grouping
- Metadata extraction and storage

#### F4: Metadata Preservation
- EXIF data (camera, lens, settings)
- GPS coordinates
- Creation/modification dates
- Location data (city, country)
- iPhone-specific metadata (Depth, Portrait, etc.)
- Sidecar JSON files for extended metadata

#### F5: Photo Organization
- Automatic date-based folder structure (YYYY/MM/DD)
- Optional location-based folders
- Album preservation from iPhone
- Custom organization rules
- Duplicate detection (by hash)

#### F6: Gallery View
- Browse all backed up photos
- Filter by date, format, location
- Search by metadata
- Full-screen preview
- Download individual photos
- Delete with confirmation

### User Interactions

#### Server Start Flow
1. User clicks "Start Server"
2. App detects local IP
3. Server starts on configured port
4. URL and QR code displayed
5. Connection status updates in real-time

#### iPhone Backup Flow
1. User opens Files app on iPhone
2. Connects to server via URL or QR
3. Navigates to Photos folder
4. Selects photos to backup
5. Copies to server location
6. App receives and processes files
7. Progress shown in upload queue

### Data Handling
- Photos stored in: `~/iPhonePhotoBridge/Backups/`
- Metadata stored in: `~/iPhonePhotoBridge/MetaData/`
- Config stored in: `~/.iPhonePhotoBridge/config.json`
- Logs stored in: `~/.iPhonePhotoBridge/logs/`

### Edge Cases
- Large file uploads (>100MB) - chunked transfer
- Network disconnection - auto-resume
- Duplicate files - prompt or skip
- Unsupported format - show warning
- Disk space low - alert before upload
- Server port in use - suggest alternatives

## 5. Acceptance Criteria

### Server Functionality
- [ ] WebDAV server starts within 3 seconds
- [ ] Server accepts connections from iPhone Files app
- [ ] File upload/download works correctly
- [ ] Metadata is preserved after transfer
- [ ] Multiple simultaneous connections supported

### Format Support
- [ ] HEIC files display correctly
- [ ] JPEG files maintain quality
- [ ] PNG files preserve transparency
- [ ] RAW files keep all data
- [ ] Live Photos save both media

### User Interface
- [ ] Dark theme displays correctly
- [ ] Responsive on various screen sizes
- [ ] Animations are smooth (60fps)
- [ ] Status updates in real-time
- [ ] All text is readable

### Data Integrity
- [ ] All EXIF metadata preserved
- [ ] File hashes match after transfer
- [ ] No data loss during conversion
- [ ] Duplicate detection works

## 6. Technology Stack

- **Runtime**: Node.js 18+
- **Frontend**: React 18 + TypeScript
- **Styling**: Tailwind CSS
- **Build**: Vite
- **WebDAV**: custom-woodman (WebDAV server)
- **Image Processing**: sharp (HEIC conversion)
- **Metadata**: exiftool-vendored
- **State Management**: Zustand
