# H10 Server

WebSocket server that receives and stores Polar H10 biometric data (HR, RR intervals, raw ECG) streamed from the AthleteOS React frontend running on Android Chrome.

---

## Requirements

- Python **3.9** or newer
- pip

---

## Installation

1. Navigate to the `h10-server` folder:

   ```bash
   cd h10-server
   ```

2. Install dependencies:

   ```bash
   pip install -r requirements.txt
   ```

---

## Finding Your Local IP Address

The React frontend needs your **computer's local IP address** on the same WiFi network as your phone. Do not use `127.0.0.1` — that only works on the same device.

**Windows**
```
ipconfig
```
Look for `IPv4 Address` under your active adapter (e.g., `192.168.1.42`).

**macOS**
```
ifconfig en0 | grep inet
```
Look for the `inet` line (not `inet6`), e.g., `inet 192.168.1.42`.

**Linux**
```
ip addr show
```
Look for `inet` under your active network interface (e.g., `eth0` or `wlan0`).

---

## Firewall Setup

The server listens on port **8765**. Allow incoming TCP connections on this port before running.

**Windows**

1. Open **Windows Defender Firewall** → **Advanced Settings**
2. **Inbound Rules** → **New Rule** → **Port**
3. TCP, specific port: `8765` → **Allow the connection**
4. Apply to all profiles (Domain, Private, Public) → Name it `H10 Server`

**macOS**

System Settings → Network → Firewall → Options → click **+** and add Python, or use:
```bash
sudo /usr/libexec/ApplicationFirewall/socketfilterfw --add $(which python3)
sudo /usr/libexec/ApplicationFirewall/socketfilterfw --unblockapp $(which python3)
```

For local testing you can also temporarily turn the firewall off under System Settings → Network → Firewall.

---

## Running the Server

```bash
python server.py
```

The server runs until you press `Ctrl+C`.

---

## Expected Terminal Output

```
[14:32:01] INFO — Server started on ws://0.0.0.0:8765
[14:32:01] INFO — Saving data to: /path/to/h10-server/data
[14:32:03] INFO — Client connected
[14:32:04] INFO — Session started: 550e8400... (streams: rr, ecg)
[14:32:05] INFO — RR seq:1 | HR:68 bpm | RR:[934.6]ms
[14:32:05] INFO — ECG seq:2 | 73 samples
[14:33:05] INFO — [60s update] RR:62 | ECG frames:390 | dropped:0
[14:45:12] WARNING — Dropped packets detected: seq jumped 5→7
[14:45:30] INFO — Session ended: duration=12m18s | RR:738 | ECG:3120 frames | quality:Good
[14:45:30] INFO — Files written:
    data/550e8400_rr.csv (738 rows)
    data/550e8400_ecg.csv (227760 rows)
[14:45:30] INFO — Connection closed
```

---

## Data Files

CSV files are saved to the `data/` folder inside `h10-server/`. Each session produces up to two files named after the session UUID.

### RR CSV — `data/<session_id>_rr.csv`

One row per RR interval value. A single BLE packet often contains 2–4 RR values; each gets its own row.

| Column | Type | Description |
|---|---|---|
| `session_id` | string | UUID of the recording session |
| `seq` | integer | Packet sequence number (monotonic, used to detect drops) |
| `timestamp_ms` | integer | Millisecond epoch timestamp from the device when the packet was sent |
| `hr_bpm` | number | Instantaneous heart rate in BPM |
| `rr_interval_ms` | number | Duration of this RR interval in milliseconds |
| `rr_index` | integer | Index of this interval within the packet (0-based) |

### ECG CSV — `data/<session_id>_ecg.csv`

One row per ECG sample. At 130 Hz a single BLE frame contains ~73 samples; each gets its own row.

| Column | Type | Description |
|---|---|---|
| `session_id` | string | UUID of the recording session |
| `seq` | integer | Packet sequence number |
| `frame_timestamp_ns` | string | Nanosecond timestamp from the Polar H10 PMD frame header (stored as string to preserve uint64 precision) |
| `sample_index` | integer | Index of this sample within the frame (0-based) |
| `ecg_uv` | integer | ECG amplitude in microvolts (signed) |

---

## Message Protocol

The server expects JSON messages with a `type` field. The frontend must send messages matching this schema:

**`session_start`**
```json
{ "type": "session_start", "session_id": "uuid", "timestamp_ms": 1700000000000, "streams": ["rr", "ecg"] }
```

**`rr`**
```json
{ "type": "rr", "session_id": "uuid", "seq": 1, "timestamp_ms": 1700000001000, "hr_bpm": 68, "rr_intervals_ms": [934.6, 921.0] }
```

**`ecg`**
```json
{ "type": "ecg", "session_id": "uuid", "seq": 2, "timestamp_ns": "1234567890000000", "samples_uv": [12, -3, 47, ...] }
```

**`session_end`**
```json
{ "type": "session_end", "session_id": "uuid", "timestamp_ms": 1700000060000 }
```

> **Note:** The AthleteOS frontend uses slightly different field names (`ts` instead of `timestamp_ms`, `hr` instead of `hr_bpm`, `rr` instead of `rr_intervals_ms`, `samples` instead of `samples_uv`). Update `H10SessionPanel.tsx` to match the schema above, or add a normalization step in `server.py`'s `_handle_message`.

---

## Troubleshooting

**"Client won't connect"**
- Verify the server shows `Server started on ws://0.0.0.0:8765` before trying to connect
- Use your computer's **local LAN IP** in the frontend settings (e.g. `192.168.1.42:8765`), not `127.0.0.1`
- Both devices must be on the **same WiFi network**
- Check firewall rules — port 8765 must allow inbound TCP
- On Android Chrome, `ws://` (not `wss://`) is required for local network addresses

**"No ECG data / ECG frames: not available"**
- The Polar Measurement Data (PMD) BLE GATT service may not be accessible from Chrome on Android
- RR interval data still works in this case — the RR CSV will still be written
- ECG is only guaranteed to work with the Polar native SDK; Chrome Web Bluetooth access to PMD varies by device and Android version

**"Many dropped packets" / quality: Poor**
- WiFi interference is the most common cause — move phone and computer closer to the router
- Avoid environments with many competing 2.4 GHz networks; connect to 5 GHz if possible
- Keep the phone screen on and the browser tab in the foreground during recording

**"Server crashes on startup"**
- Check Python version: `python --version` (must be 3.9 or newer)
- Reinstall dependencies: `pip install --force-reinstall -r requirements.txt`
- Check if another process already uses port 8765:
  - Mac/Linux: `lsof -i :8765`
  - Windows: `netstat -ano | findstr :8765`
- If port is in use, change `PORT = 8765` in `server.py` and update the frontend to match

**"Permission denied writing to data/"**
- The server creates `data/` automatically, but the folder may have been created by another user
- Delete it and let the server recreate it: `rm -rf data/`
