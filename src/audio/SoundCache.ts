/**
 * SoundCache.ts
 * Управление кэшированием и математически бесшовным зацикливанием аудиосэмплов.
 */

/**
 * Создает бесшовный AudioBuffer с формулой equal-power кроссфейда.
 * Хвост длиной K секунд подмешивается в начало буфера,
 * устраняя фазовые скачки и щелчки при source.loop = true.
 */
export function createSeamlessLoopBuffer(
  ctx: AudioContext,
  sourceBuffer: AudioBuffer,
  crossfadeSec = 2.0
): AudioBuffer {
  const N = sourceBuffer.length;
  const sampleRate = sourceBuffer.sampleRate;
  const numChannels = sourceBuffer.numberOfChannels;

  let K = Math.floor(crossfadeSec * sampleRate);
  // Если файл слишком короткий для заданного crossfadeSec, ограничиваем K четвертью длины
  if (K >= Math.floor(N * 0.5)) {
    K = Math.max(1, Math.floor(N * 0.25));
  }

  const N_loop = N - K;
  if (N_loop <= 0 || K <= 0) {
    return sourceBuffer;
  }

  const loopBuffer = ctx.createBuffer(numChannels, N_loop, sampleRate);

  for (let ch = 0; ch < numChannels; ch++) {
    const sourceData = sourceBuffer.getChannelData(ch);
    const loopData = loopBuffer.getChannelData(ch);

    // Зона кроссфейда: [0, K)
    // Входящий хвост [N - K .. N) плавно уходит (cos),
    // начало файла [0 .. K) плавно нарастает (sin).
    for (let i = 0; i < K; i++) {
      const t = i / K;
      const wIn = Math.sin((t * Math.PI) / 2);
      const wOut = Math.cos((t * Math.PI) / 2);

      loopData[i] = sourceData[i] * wIn + sourceData[N - K + i] * wOut;
    }

    // Оставшаяся часть [K .. N_loop) копируется мгновенно через быстрый нативный memcpy
    loopData.set(sourceData.subarray(K, N_loop), K);
  }

  return loopBuffer;
}

export class SoundCache {
  private buffers: Map<string, AudioBuffer> = new Map();
  private pending: Map<string, Promise<AudioBuffer>> = new Map();

  /**
   * Загружает аудиофайл по URL, декодирует и зацикливает без швов.
   * При повторных вызовах возвращает закэшированный буфер или активный промис.
   */
  public async loadLoopBuffer(
    ctx: AudioContext,
    url: string,
    crossfadeSec = 2.0
  ): Promise<AudioBuffer> {
    const cached = this.buffers.get(url);
    if (cached) {
      return cached;
    }

    const pendingPromise = this.pending.get(url);
    if (pendingPromise) {
      return pendingPromise;
    }

    const loadPromise = (async () => {
      try {
        let response: Response;
        try {
          response = await fetch(url);
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
        } catch {
          const clean = url.replace(/^\.?\//, '');
          response = await fetch(clean);
          if (!response.ok) {
            throw new Error(`Failed to load audio from "${url}" or "${clean}": HTTP ${response.status}`);
          }
        }
        const arrayBuffer = await response.arrayBuffer();
        // slice(0) защищает ArrayBuffer от отсоединения в некоторых реализациях Web Audio
        const decoded = await ctx.decodeAudioData(arrayBuffer.slice(0));
        const loopBuffer = createSeamlessLoopBuffer(ctx, decoded, crossfadeSec);
        this.buffers.set(url, loopBuffer);
        return loopBuffer;
      } catch (err) {
        console.error(`[SoundCache] Error loading "${url}":`, err);
        throw err;
      } finally {
        this.pending.delete(url);
      }
    })();

    this.pending.set(url, loadPromise);
    return loadPromise;
  }

  /**
   * Предзагрузка массива URL в кэш
   */
  public async preload(ctx: AudioContext, urls: string[], crossfadeSec = 2.0): Promise<void> {
    await Promise.all(
      urls.map((url) =>
        this.loadLoopBuffer(ctx, url, crossfadeSec).catch((err) => {
          console.warn(`[SoundCache] Preload warning for "${url}":`, err);
        })
      )
    );
  }

  public getBuffer(url: string): AudioBuffer | undefined {
    return this.buffers.get(url);
  }

  public hasBuffer(url: string): boolean {
    return this.buffers.has(url);
  }

  public clear(): void {
    this.buffers.clear();
    this.pending.clear();
  }
}

export const soundCache = new SoundCache();
