/**
 * Minimal in-place radix-2 FFT — enough for onset-detection magnitude
 * spectra; no external deps.
 */
export class FFT {
  private readonly cosTable: Float32Array;
  private readonly sinTable: Float32Array;
  private readonly reverse: Uint32Array;

  constructor(readonly size: number) {
    if ((size & (size - 1)) !== 0) throw new Error('FFT size must be a power of 2');
    this.cosTable = new Float32Array(size / 2);
    this.sinTable = new Float32Array(size / 2);
    for (let i = 0; i < size / 2; i++) {
      this.cosTable[i] = Math.cos((-2 * Math.PI * i) / size);
      this.sinTable[i] = Math.sin((-2 * Math.PI * i) / size);
    }
    this.reverse = new Uint32Array(size);
    const bits = Math.log2(size);
    for (let i = 0; i < size; i++) {
      let r = 0;
      for (let b = 0; b < bits; b++) r = (r << 1) | ((i >> b) & 1);
      this.reverse[i] = r;
    }
  }

  /** Real input → magnitude spectrum (first size/2 bins) written to `out`. */
  magnitudes(input: Float32Array, out: Float32Array): void {
    const n = this.size;
    const re = new Float32Array(n);
    const im = new Float32Array(n);
    for (let i = 0; i < n; i++) re[this.reverse[i]] = input[i];

    for (let len = 2; len <= n; len <<= 1) {
      const half = len >> 1;
      const step = n / len;
      for (let i = 0; i < n; i += len) {
        for (let j = 0; j < half; j++) {
          const k = j * step;
          const tRe = re[i + j + half] * this.cosTable[k] - im[i + j + half] * this.sinTable[k];
          const tIm = re[i + j + half] * this.sinTable[k] + im[i + j + half] * this.cosTable[k];
          re[i + j + half] = re[i + j] - tRe;
          im[i + j + half] = im[i + j] - tIm;
          re[i + j] += tRe;
          im[i + j] += tIm;
        }
      }
    }
    for (let i = 0; i < n / 2; i++) {
      out[i] = Math.hypot(re[i], im[i]);
    }
  }
}
