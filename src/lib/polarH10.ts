const HEART_RATE_SERVICE = 'heart_rate';
const HEART_RATE_MEASUREMENT = 'heart_rate_measurement';
const BATTERY_SERVICE = 'battery_service';
const BATTERY_LEVEL = 'battery_level';

const PMD_SERVICE = 'fb005c80-02e7-f387-1cad-8acd2d8df0c8';
const PMD_CONTROL = 'fb005c81-02e7-f387-1cad-8acd2d8df0c8';
const PMD_DATA = 'fb005c82-02e7-f387-1cad-8acd2d8df0c8';

// ECG at 130 Hz, 14-bit resolution
const ECG_START_CMD = new Uint8Array([
  0x02, 0x00,       // START_MEASUREMENT, ECG
  0x00, 0x01, 0x82, 0x00,  // SAMPLE_RATE: 130 Hz
  0x01, 0x01, 0x0e, 0x00,  // RESOLUTION: 14 bits
]);

export interface PolarH10Callbacks {
  onHeartRate: (bpm: number, rrIntervals: number[]) => void;
  onEcgSamples: (samples: number[], timestampNs: bigint) => void;
  onBattery: (level: number) => void;
  onError: (error: Error) => void;
  onDisconnect: () => void;
}

export class PolarH10 {
  private device: BluetoothDevice | null = null;
  private server: BluetoothRemoteGATTServer | null = null;
  private callbacks: PolarH10Callbacks;

  constructor(callbacks: PolarH10Callbacks) {
    this.callbacks = callbacks;
  }

  async connect(): Promise<string> {
    this.device = await navigator.bluetooth.requestDevice({
      filters: [{ namePrefix: 'Polar' }],
      optionalServices: [HEART_RATE_SERVICE, BATTERY_SERVICE, PMD_SERVICE],
    });

    this.device.addEventListener('gattserverdisconnected', () => {
      this.server = null;
      this.callbacks.onDisconnect();
    });

    this.server = await this.device.gatt!.connect();
    await this._subscribeHeartRate();
    await this._subscribeBattery();
    await this._startEcg();

    return this.device.name ?? 'Polar H10';
  }

  disconnect() {
    if (this.device?.gatt?.connected) {
      this.device.gatt.disconnect();
    }
  }

  get deviceName(): string | null {
    return this.device?.name ?? null;
  }

  private async _subscribeHeartRate() {
    const service = await this.server!.getPrimaryService(HEART_RATE_SERVICE);
    const char = await service.getCharacteristic(HEART_RATE_MEASUREMENT);
    await char.startNotifications();
    char.addEventListener('characteristicvaluechanged', (e: Event) => {
      const v = (e.target as BluetoothRemoteGATTCharacteristic).value!;
      this.callbacks.onHeartRate(...parseHRM(v));
    });
  }

  private async _subscribeBattery() {
    try {
      const service = await this.server!.getPrimaryService(BATTERY_SERVICE);
      const char = await service.getCharacteristic(BATTERY_LEVEL);
      const value = await char.readValue();
      this.callbacks.onBattery(value.getUint8(0));
      await char.startNotifications();
      char.addEventListener('characteristicvaluechanged', (e) => {
        const v = (e.target as BluetoothRemoteGATTCharacteristic).value!;
        this.callbacks.onBattery(v.getUint8(0));
      });
    } catch {
      // battery service not critical
    }
  }

  private async _startEcg() {
    const service = await this.server!.getPrimaryService(PMD_SERVICE);

    const data = await service.getCharacteristic(PMD_DATA);
    await data.startNotifications();
    data.addEventListener('characteristicvaluechanged', (e) => {
      const v = (e.target as BluetoothRemoteGATTCharacteristic).value!;
      const parsed = parseEcgPacket(v);
      if (parsed) this.callbacks.onEcgSamples(parsed.samples, parsed.timestampNs);
    });

    const ctrl = await service.getCharacteristic(PMD_CONTROL);
    await ctrl.startNotifications();
    await ctrl.writeValueWithResponse(ECG_START_CMD);
  }
}

function parseHRM(v: DataView): [number, number[]] {
  const flags = v.getUint8(0);
  const rate16 = flags & 0x1;
  const bpm = rate16 ? v.getUint16(1, true) : v.getUint8(1);
  const rrOffset = rate16 ? 3 : 2;
  const rr: number[] = [];
  for (let i = rrOffset; i + 1 < v.byteLength; i += 2) {
    rr.push((v.getUint16(i, true) / 1024) * 1000); // ms
  }
  return [bpm, rr];
}

function parseEcgPacket(v: DataView): { samples: number[]; timestampNs: bigint } | null {
  if (v.byteLength < 10) return null;
  const type = v.getUint8(0);
  if (type !== 0x00) return null; // ECG type

  const timestampNs =
    BigInt(v.getUint32(1, true)) | (BigInt(v.getUint32(5, true)) << 32n);

  // frame type at byte 9; 0 = raw samples
  const frameType = v.getUint8(9);
  if (frameType !== 0x00) return null;

  const samples: number[] = [];
  for (let i = 10; i + 2 < v.byteLength; i += 3) {
    // Each sample is a 24-bit little-endian signed integer (14-bit ADC, sign-extended)
    const unsigned = v.getUint8(i) | (v.getUint8(i + 1) << 8) | (v.getUint8(i + 2) << 16);
    const signed = unsigned >= 0x800000 ? unsigned - 0x1000000 : unsigned;
    samples.push(signed);
  }

  return { samples, timestampNs };
}
