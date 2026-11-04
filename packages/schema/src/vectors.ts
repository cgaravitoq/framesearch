const MAGIC = 0x46535645;
const VERSION = 1;
const HEADER_BYTES = 15;
const RECORD_HEADER_BYTES = 4;

export interface ShotVector {
  shotId: number;
  values: Int8Array;
}

export interface FilmVectors {
  dim: number;
  frames: ShotVector[];
  captions: ShotVector[];
}

export function encodeVectors(vectors: FilmVectors): Uint8Array {
  const { dim, frames, captions } = vectors;
  if (!Number.isInteger(dim) || dim < 1 || dim > 0xffff) {
    throw new Error(`invalid vector dimension ${dim}`);
  }
  const records = [...frames, ...captions];
  const bytes = new Uint8Array(
    HEADER_BYTES + records.length * (RECORD_HEADER_BYTES + dim),
  );
  const view = new DataView(bytes.buffer);
  view.setUint32(0, MAGIC, true);
  bytes[4] = VERSION;
  view.setUint16(5, dim, true);
  view.setUint32(7, frames.length, true);
  view.setUint32(11, captions.length, true);
  let at = HEADER_BYTES;
  for (const record of records) {
    if (record.values.length !== dim) {
      throw new Error(
        `shot ${record.shotId} carries ${record.values.length} values, expected ${dim}`,
      );
    }
    view.setUint32(at, record.shotId, true);
    bytes.set(
      new Uint8Array(record.values.buffer, record.values.byteOffset, dim),
      at + RECORD_HEADER_BYTES,
    );
    at += RECORD_HEADER_BYTES + dim;
  }
  return bytes;
}

export function decodeVectors(buffer: ArrayBuffer | Uint8Array): FilmVectors {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  if (bytes.byteLength < HEADER_BYTES) {
    throw new Error(
      `truncated vector file: ${bytes.byteLength} bytes, expected at least ${HEADER_BYTES}`,
    );
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(0, true) !== MAGIC) {
    throw new Error("not a framesearch vector file");
  }
  const version = view.getUint8(4);
  if (version !== VERSION) {
    throw new Error(`unsupported vector file version ${version}`);
  }
  const dim = view.getUint16(5, true);
  if (dim < 1) throw new Error("vector file declares no dimensions");
  const frameCount = view.getUint32(7, true);
  const captionCount = view.getUint32(11, true);
  const expected =
    HEADER_BYTES + (frameCount + captionCount) * (RECORD_HEADER_BYTES + dim);
  if (bytes.byteLength < expected) {
    throw new Error(
      `truncated vector file: ${bytes.byteLength} bytes, expected ${expected}`,
    );
  }
  let at = HEADER_BYTES;
  const read = (count: number): ShotVector[] => {
    const records: ShotVector[] = [];
    for (let index = 0; index < count; index += 1) {
      const shotId = view.getUint32(at, true);
      const values = new Int8Array(dim);
      values.set(
        new Int8Array(
          bytes.buffer,
          bytes.byteOffset + at + RECORD_HEADER_BYTES,
          dim,
        ),
      );
      records.push({ shotId, values });
      at += RECORD_HEADER_BYTES + dim;
    }
    return records;
  };
  const frames = read(frameCount);
  const captions = read(captionCount);
  return { dim, frames, captions };
}
