/**
 * AudioEngine.ts
 * Ядро аудио-движка Atmos с поддержкой бесшовных сэмплов, процедурного синтеза
 * и кроссфейда вариаций интенсивностей.
 */

import {
  createBrownNoiseBuffer,
} from './NoiseGenerators';
import { soundCache } from './SoundCache';
import { ALL_SAMPLE_URLS } from '../config';

export type IntensityLevel = 'light' | 'moderate' | 'strong';

export interface SoundTrackConfig {
  id: string;
  name: string;
  intensityLabels: Record<IntensityLevel, string>;
  icon: string;
  defaultVolume: number;
  sampleUrls?: Partial<Record<IntensityLevel, string>>;
}

export interface SoundChannelState {
  id: string;
  volume: number; // 0..100
  intensity: IntensityLevel;
  active: boolean;
}

interface AudioTrackInstance {
  masterGain: GainNode;
  setIntensity: (level: IntensityLevel) => void;
  onPlayStateChange?: (playing: boolean) => void;
  cleanup: () => void;
}

export class AudioEngine {
  private ctx: AudioContext | null = null;
  private masterGainNode: GainNode | null = null;
  private tracks: Map<string, AudioTrackInstance> = new Map();
  private isMuted: boolean = false;
  private masterVolume: number = 0.4; // 0..1
  private isPlaying: boolean = false;

  // Cached shared procedural noise buffers
  private brownBuffer: AudioBuffer | null = null;

  constructor() {}

  /**
   * Нормализует id трека для обеспечения обратной совместимости ('fire' <-> 'fireplace').
   */
  private normalizeTrackId(id: string): string {
    return id === 'fire' ? 'fireplace' : id;
  }

  public resumeContext() {
    this.initContextIfNeeded();
    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume();
    }
  }

  private initContextIfNeeded() {
    if (!this.ctx) {
      const AudioCtx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.ctx = new AudioCtx();

      this.masterGainNode = this.ctx.createGain();
      this.masterGainNode.gain.setValueAtTime(
        this.isMuted ? 0 : this.masterVolume,
        this.ctx.currentTime
      );
      this.masterGainNode.connect(this.ctx.destination);

      // Генерация базовых процедурных шумов (8 секунд)
      this.brownBuffer = createBrownNoiseBuffer(this.ctx, 8);

      // Фоновая предзагрузка всех реальных аудиосэмплов с бесшовным кроссфейдом
      soundCache.preload(this.ctx, ALL_SAMPLE_URLS);
    }

    if (this.ctx.state === 'suspended') {
      this.ctx.resume();
    }
  }

  public async start() {
    this.initContextIfNeeded();
    if (!this.ctx || !this.masterGainNode) return;
    this.isPlaying = true;

    // Плавное нарастание общей громкости без щелчков
    const now = this.ctx.currentTime;
    this.masterGainNode.gain.cancelScheduledValues(now);
    this.masterGainNode.gain.setValueAtTime(this.masterGainNode.gain.value, now);
    this.masterGainNode.gain.linearRampToValueAtTime(
      this.isMuted ? 0 : this.masterVolume,
      now + 0.08
    );

    // Уведомление треков о начале воспроизведения
    this.tracks.forEach((t) => t.onPlayStateChange?.(true));
  }

  public pause() {
    if (!this.ctx || !this.masterGainNode) return;
    this.isPlaying = false;

    // Мягкое затухание мастер-громкости
    const now = this.ctx.currentTime;
    this.masterGainNode.gain.cancelScheduledValues(now);
    this.masterGainNode.gain.setValueAtTime(this.masterGainNode.gain.value, now);
    this.masterGainNode.gain.linearRampToValueAtTime(0, now + 0.08);

    // Остановка генераторов и освобождение аудиоузлов для сохранения ресурсов
    this.tracks.forEach((t) => t.onPlayStateChange?.(false));
  }

  public getIsPlaying(): boolean {
    return this.isPlaying;
  }

  public setMasterVolume(vol: number) {
    this.masterVolume = Math.max(0, Math.min(100, vol)) / 100;
    if (this.ctx && this.masterGainNode && this.isPlaying && !this.isMuted) {
      const now = this.ctx.currentTime;
      this.masterGainNode.gain.cancelScheduledValues(now);
      this.masterGainNode.gain.setValueAtTime(this.masterGainNode.gain.value, now);
      this.masterGainNode.gain.linearRampToValueAtTime(this.masterVolume, now + 0.05);
    }
  }

  public setMuted(muted: boolean) {
    this.isMuted = muted;
    if (this.ctx && this.masterGainNode && this.isPlaying) {
      const now = this.ctx.currentTime;
      this.masterGainNode.gain.cancelScheduledValues(now);
      this.masterGainNode.gain.setValueAtTime(this.masterGainNode.gain.value, now);
      this.masterGainNode.gain.linearRampToValueAtTime(
        this.isMuted ? 0 : this.masterVolume,
        now + 0.05
      );
    }
  }

  public setTrackVolume(trackId: string, volume: number) {
    this.initContextIfNeeded();
    const id = this.normalizeTrackId(trackId);
    this.ensureTrack(id);
    const instance = this.tracks.get(id);
    if (instance && this.ctx) {
      const targetGain = Math.max(0, Math.min(100, volume)) / 100;
      const now = this.ctx.currentTime;
      instance.masterGain.gain.cancelScheduledValues(now);
      instance.masterGain.gain.setValueAtTime(instance.masterGain.gain.value, now);
      instance.masterGain.gain.linearRampToValueAtTime(targetGain, now + 0.05);
    }
  }

  public setTrackIntensity(trackId: string, intensity: IntensityLevel) {
    this.initContextIfNeeded();
    const id = this.normalizeTrackId(trackId);
    this.ensureTrack(id);
    const instance = this.tracks.get(id);
    if (instance) {
      instance.setIntensity(intensity);
    }
  }

  private ensureTrack(trackId: string) {
    const id = this.normalizeTrackId(trackId);
    if (this.tracks.has(id)) return;
    if (!this.ctx || !this.masterGainNode) return;

    let trackInstance: AudioTrackInstance | null = null;
    switch (id) {
      case 'rain':
        trackInstance = this.buildRainTrack();
        break;
      case 'thunder':
        trackInstance = this.buildThunderTrack();
        break;
      case 'ocean':
        trackInstance = this.buildOceanTrack();
        break;
      case 'wind':
        trackInstance = this.buildWindTrack();
        break;
      case 'forest':
        trackInstance = this.buildForestTrack();
        break;
      case 'fireplace':
        trackInstance = this.buildFireplaceTrack();
        break;
      case 'train':
        trackInstance = this.buildTrainTrack();
        break;
    }

    if (trackInstance) {
      trackInstance.masterGain.connect(this.masterGainNode);
      if (this.isPlaying) {
        trackInstance.onPlayStateChange?.(true);
      }
      this.tracks.set(id, trackInstance);
    }
  }

  // =========================================================================
  // УНИВЕРСАЛЬНЫЙ ТРЕК НА БЕСШОВНЫХ СЭМПЛАХ С КРОССФЕЙДОМ ВАРИАЦИЙ (0.4 сек)
  // =========================================================================
  private buildSeamlessSampleTrack(
    sampleUrls: Record<IntensityLevel, string>,
    defaultLevel: IntensityLevel = 'moderate'
  ): AudioTrackInstance {
    const ctx = this.ctx!;
    const trackGain = ctx.createGain();
    trackGain.gain.setValueAtTime(0, ctx.currentTime);

    let currentLevel: IntensityLevel = defaultLevel;
    let isPlaying = this.isPlaying;

    interface ActiveVoice {
      source: AudioBufferSourceNode;
      gainNode: GainNode;
      level: IntensityLevel;
    }

    let activeVoice: ActiveVoice | null = null;

    const startVariation = (level: IntensityLevel, fadeSec = 0.4) => {
      if (!isPlaying) return;
      const url = sampleUrls[level];
      if (!url) return;

      // Если вариация уже играет — ничего не переключаем
      if (activeVoice && activeVoice.level === level) {
        return;
      }

      const previousVoice = activeVoice;
      const now = ctx.currentTime;

      const newGain = ctx.createGain();
      newGain.gain.setValueAtTime(0, now);
      newGain.connect(trackGain);

      const applyBuffer = (buffer: AudioBuffer) => {
        if (!isPlaying || currentLevel !== level) {
          try {
            newGain.disconnect();
          } catch {}
          return;
        }

        const source = ctx.createBufferSource();
        source.buffer = buffer;
        source.loop = true;
        source.connect(newGain);

        // Случайное смещение для естественности при запуске
        const offset = Math.random() * Math.max(0, buffer.duration - 1);
        const startTime = ctx.currentTime;
        source.start(startTime, offset);

        newGain.gain.cancelScheduledValues(startTime);
        newGain.gain.setValueAtTime(0, startTime);
        newGain.gain.linearRampToValueAtTime(1.0, startTime + fadeSec);

        activeVoice = {
          source,
          gainNode: newGain,
          level,
        };

        // Плавный фейд-аут предыдущей вариации (0.4с кроссфейд)
        if (previousVoice) {
          const oldGain = previousVoice.gainNode;
          const oldSource = previousVoice.source;
          oldGain.gain.cancelScheduledValues(startTime);
          oldGain.gain.setValueAtTime(oldGain.gain.value, startTime);
          oldGain.gain.linearRampToValueAtTime(0, startTime + fadeSec);

          window.setTimeout(() => {
            try {
              oldSource.stop();
              oldSource.disconnect();
              oldGain.disconnect();
            } catch {}
          }, Math.ceil((fadeSec + 0.05) * 1000));
        }
      };

      const cached = soundCache.getBuffer(url);
      if (cached) {
        applyBuffer(cached);
      } else {
        soundCache
          .loadLoopBuffer(ctx, url)
          .then((buf) => applyBuffer(buf))
          .catch((err) => console.warn(`[AudioEngine] Failed to load sample ${url}:`, err));
      }
    };

    const stopAllVoices = (fadeSec = 0.08) => {
      if (!activeVoice) return;
      const now = ctx.currentTime;
      const voice = activeVoice;
      activeVoice = null;

      voice.gainNode.gain.cancelScheduledValues(now);
      voice.gainNode.gain.setValueAtTime(voice.gainNode.gain.value, now);
      voice.gainNode.gain.linearRampToValueAtTime(0, now + fadeSec);

      window.setTimeout(() => {
        try {
          voice.source.stop();
          voice.source.disconnect();
          voice.gainNode.disconnect();
        } catch {}
      }, Math.ceil((fadeSec + 0.05) * 1000));
    };

    const setIntensity = (level: IntensityLevel) => {
      currentLevel = level;
      if (isPlaying) {
        startVariation(level, 0.4);
      }
    };

    return {
      masterGain: trackGain,
      setIntensity,
      onPlayStateChange: (playing: boolean) => {
        isPlaying = playing;
        if (playing) {
          startVariation(currentLevel, 0.2);
        } else {
          stopAllVoices(0.08);
        }
      },
      cleanup: () => {
        isPlaying = false;
        stopAllVoices(0.02);
        try {
          trackGain.disconnect();
        } catch {}
      },
    };
  }

  // --- 1. RAIN TRACK (Сэмплы с бесшовным кроссфейдом) ---
  // light: rain_roof.mp3 ('ПО КРЫШЕ')
  // moderate: rain_tropical.mp3 ('ТРОПИЧЕСКИЙ')
  // strong: rain_heavy_forest.mp3 ('ЛИВЕНЬ')
  private buildRainTrack(): AudioTrackInstance {
    return this.buildSeamlessSampleTrack({
      light: '/audio/rain_roof.mp3',
      moderate: '/audio/rain_tropical.mp3',
      strong: '/audio/rain_heavy_forest.mp3',
    });
  }

  // --- 2. OCEAN TRACK (Сэмплы морского прибоя) ---
  // light: ocean_beach.mp3 ('ПЛЯЖ')
  // moderate: ocean_rocky.mp3 ('КАМЕННЫЙ БЕРЕГ')
  // strong: ocean_rocks.mp3 ('ПРИБОЙ О СКАЛЫ')
  private buildOceanTrack(): AudioTrackInstance {
    return this.buildSeamlessSampleTrack({
      light: '/audio/ocean_beach.mp3',
      moderate: '/audio/ocean_rocky.mp3',
      strong: '/audio/ocean_rocks.mp3',
    });
  }

  // --- 3. FOREST TRACK (Сэмплы леса и птиц) ---
  // light: forest_night.mp3 ('НОЧНОЙ ЛЕС')
  // moderate: forest_birds.mp3 ('ЛЕС И ПТИЦЫ')
  // strong: stream_forest.mp3 ('ЛЕСНОЙ РУЧЕЙ')
  private buildForestTrack(): AudioTrackInstance {
    return this.buildSeamlessSampleTrack({
      light: '/audio/forest_night.mp3',
      moderate: '/audio/forest_birds.mp3',
      strong: '/audio/stream_forest.mp3',
    });
  }

  // --- TRAIN TRACK (Стук колес поезда) ---
  // light: train_soft.mp3 ('МЯГКИЙ СТУК')
  // moderate: train_wagon.mp3 ('ИЗ ВАГОНА')
  // strong: train_wagon.mp3 ('СКОРОСТНОЙ' с темпом 1.08 и подъемом динамики)
  private buildTrainTrack(): AudioTrackInstance {
    const ctx = this.ctx!;
    const trackGain = ctx.createGain();
    trackGain.gain.setValueAtTime(0, ctx.currentTime);

    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(8000, ctx.currentTime);
    filter.connect(trackGain);

    let currentLevel: IntensityLevel = 'moderate';
    let isPlaying = this.isPlaying;

    interface ActiveVoice {
      source: AudioBufferSourceNode;
      gainNode: GainNode;
      level: IntensityLevel;
    }

    let activeVoice: ActiveVoice | null = null;

    const sampleUrls: Record<IntensityLevel, string> = {
      light: '/audio/train_soft.mp3',
      moderate: '/audio/train_wagon.mp3',
      strong: '/audio/train_wagon.mp3',
    };

    const startVariation = (level: IntensityLevel, fadeSec = 0.4) => {
      if (!isPlaying) return;
      const url = sampleUrls[level];
      if (!url) return;

      if (activeVoice && activeVoice.level === level) {
        return;
      }

      const previousVoice = activeVoice;
      const now = ctx.currentTime;

      const newGain = ctx.createGain();
      newGain.gain.setValueAtTime(0, now);
      newGain.connect(filter);

      const applyBuffer = (buffer: AudioBuffer) => {
        if (!isPlaying || currentLevel !== level) {
          try {
            newGain.disconnect();
          } catch {}
          return;
        }

        const source = ctx.createBufferSource();
        source.buffer = buffer;
        source.loop = true;

        if (level === 'strong') {
          // Скоростной экспресс: чуть ускоренный темп стука колес и более открытые высокие частоты
          source.playbackRate.setValueAtTime(1.08, ctx.currentTime);
          filter.frequency.setValueAtTime(10000, ctx.currentTime);
        } else if (level === 'light') {
          source.playbackRate.setValueAtTime(1.0, ctx.currentTime);
          filter.frequency.setValueAtTime(5000, ctx.currentTime);
        } else {
          source.playbackRate.setValueAtTime(1.0, ctx.currentTime);
          filter.frequency.setValueAtTime(8000, ctx.currentTime);
        }

        source.connect(newGain);

        const offset = Math.random() * Math.max(0, buffer.duration - 1);
        const startTime = ctx.currentTime;
        source.start(startTime, offset);

        const targetGainVal = level === 'strong' ? 1.15 : 1.0;
        newGain.gain.cancelScheduledValues(startTime);
        newGain.gain.setValueAtTime(0, startTime);
        newGain.gain.linearRampToValueAtTime(targetGainVal, startTime + fadeSec);

        activeVoice = {
          source,
          gainNode: newGain,
          level,
        };

        if (previousVoice) {
          const oldGain = previousVoice.gainNode;
          const oldSource = previousVoice.source;
          oldGain.gain.cancelScheduledValues(startTime);
          oldGain.gain.setValueAtTime(oldGain.gain.value, startTime);
          oldGain.gain.linearRampToValueAtTime(0, startTime + fadeSec);

          window.setTimeout(() => {
            try {
              oldSource.stop();
              oldSource.disconnect();
              oldGain.disconnect();
            } catch {}
          }, Math.ceil((fadeSec + 0.05) * 1000));
        }
      };

      const cached = soundCache.getBuffer(url);
      if (cached) {
        applyBuffer(cached);
      } else {
        soundCache
          .loadLoopBuffer(ctx, url)
          .then((buf) => applyBuffer(buf))
          .catch((err) => console.warn(`[TrainTrack] Failed to load sample ${url}:`, err));
      }
    };

    const stopAllVoices = (fadeSec = 0.08) => {
      if (!activeVoice) return;
      const now = ctx.currentTime;
      const voice = activeVoice;
      activeVoice = null;

      voice.gainNode.gain.cancelScheduledValues(now);
      voice.gainNode.gain.setValueAtTime(voice.gainNode.gain.value, now);
      voice.gainNode.gain.linearRampToValueAtTime(0, now + fadeSec);

      window.setTimeout(() => {
        try {
          voice.source.stop();
          voice.source.disconnect();
          voice.gainNode.disconnect();
        } catch {}
      }, Math.ceil((fadeSec + 0.05) * 1000));
    };

    const setIntensity = (level: IntensityLevel) => {
      currentLevel = level;
      if (isPlaying) {
        startVariation(level, 0.4);
      }
    };

    return {
      masterGain: trackGain,
      setIntensity,
      onPlayStateChange: (playing: boolean) => {
        isPlaying = playing;
        if (playing) {
          startVariation(currentLevel, 0.2);
        } else {
          stopAllVoices(0.08);
        }
      },
      cleanup: () => {
        isPlaying = false;
        stopAllVoices(0.02);
        try {
          filter.disconnect();
          trackGain.disconnect();
        } catch {}
      },
    };
  }

  // --- 4. WIND TRACK ---
  // light: wind_day.mp3 + мягкий Lowpass фильтр ('ТИХИЙ ДЕНЬ')
  // moderate: wind_day.mp3 широкий спектр ('ВЕТРЕНЫЙ ДЕНЬ')
  // strong: wind_day.mp3 + резонансный полосовой фильтр с динамическими порывами ('ПОРЫВЫ ВЕТРА')
  private buildWindTrack(): AudioTrackInstance {
    const ctx = this.ctx!;
    const trackGain = ctx.createGain();
    trackGain.gain.setValueAtTime(0, ctx.currentTime);

    const voiceGain = ctx.createGain();
    voiceGain.gain.setValueAtTime(0, ctx.currentTime);

    // Фильтр низких частот (Lowpass) для смягчения верхнего диапазона
    const lpf = ctx.createBiquadFilter();
    lpf.type = 'lowpass';
    lpf.frequency.setValueAtTime(2600, ctx.currentTime);
    lpf.Q.setValueAtTime(0.707, ctx.currentTime);

    // Резонансный Peaking фильтр для создания реалистичного завывания и порывов ветра
    const peaking = ctx.createBiquadFilter();
    peaking.type = 'peaking';
    peaking.frequency.setValueAtTime(650, ctx.currentTime);
    peaking.Q.setValueAtTime(2.2, ctx.currentTime);
    peaking.gain.setValueAtTime(0, ctx.currentTime);

    // LFO модуляция для порывов ветра в режиме 'strong'
    const gustLfo = ctx.createOscillator();
    gustLfo.type = 'sine';
    gustLfo.frequency.setValueAtTime(0.2, ctx.currentTime);

    const gustGain = ctx.createGain();
    gustGain.gain.setValueAtTime(0, ctx.currentTime);

    gustLfo.connect(gustGain);
    gustGain.connect(peaking.frequency);
    gustLfo.start();

    // Цепь аудио: source -> lpf -> peaking -> voiceGain -> trackGain
    lpf.connect(peaking);
    peaking.connect(voiceGain);
    voiceGain.connect(trackGain);

    let activeSource: AudioBufferSourceNode | null = null;
    let currentLevel: IntensityLevel = 'moderate';
    let isPlaying = this.isPlaying;

    const applyIntensityFilters = (level: IntensityLevel, fadeSec = 0.4) => {
      const now = ctx.currentTime;
      lpf.frequency.cancelScheduledValues(now);
      lpf.frequency.setValueAtTime(lpf.frequency.value, now);

      peaking.gain.cancelScheduledValues(now);
      peaking.gain.setValueAtTime(peaking.gain.value, now);

      gustGain.gain.cancelScheduledValues(now);
      gustGain.gain.setValueAtTime(gustGain.gain.value, now);

      if (level === 'light') {
        // Мягкий шелестящий ветерок без резкого свиста
        lpf.frequency.linearRampToValueAtTime(800, now + fadeSec);
        peaking.gain.linearRampToValueAtTime(-2, now + fadeSec);
        gustGain.gain.linearRampToValueAtTime(0, now + fadeSec);
      } else if (level === 'moderate') {
        // Натуральный открытый ветреный день
        lpf.frequency.linearRampToValueAtTime(2800, now + fadeSec);
        peaking.gain.linearRampToValueAtTime(2, now + fadeSec);
        gustGain.gain.linearRampToValueAtTime(40, now + fadeSec);
      } else {
        // Мощные порывы ветра с резонансным завыванием
        lpf.frequency.linearRampToValueAtTime(4200, now + fadeSec);
        peaking.gain.linearRampToValueAtTime(8, now + fadeSec);
        gustGain.gain.linearRampToValueAtTime(180, now + fadeSec);
      }
    };

    const startWind = () => {
      if (!isPlaying || activeSource) return;
      const url = '/audio/wind_day.mp3';

      const startWithBuffer = (buffer: AudioBuffer) => {
        if (!isPlaying || activeSource) return;
        const source = ctx.createBufferSource();
        source.buffer = buffer;
        source.loop = true;
        source.connect(lpf);

        const offset = Math.random() * Math.max(0, buffer.duration - 1);
        const now = ctx.currentTime;
        source.start(now, offset);

        voiceGain.gain.cancelScheduledValues(now);
        voiceGain.gain.setValueAtTime(0, now);
        voiceGain.gain.linearRampToValueAtTime(1.0, now + 0.2);

        activeSource = source;
      };

      const cached = soundCache.getBuffer(url);
      if (cached) {
        startWithBuffer(cached);
      } else {
        soundCache
          .loadLoopBuffer(ctx, url)
          .then((buf) => startWithBuffer(buf))
          .catch((err) => console.warn('[WindTrack] Failed to load wind sample:', err));
      }
    };

    const stopWind = (fadeSec = 0.08) => {
      if (!activeSource) return;
      const src = activeSource;
      activeSource = null;

      const now = ctx.currentTime;
      voiceGain.gain.cancelScheduledValues(now);
      voiceGain.gain.setValueAtTime(voiceGain.gain.value, now);
      voiceGain.gain.linearRampToValueAtTime(0, now + fadeSec);

      window.setTimeout(() => {
        try {
          src.stop();
          src.disconnect();
        } catch {}
      }, Math.ceil((fadeSec + 0.05) * 1000));
    };

    applyIntensityFilters(currentLevel, 0.01);

    return {
      masterGain: trackGain,
      setIntensity: (level: IntensityLevel) => {
        currentLevel = level;
        applyIntensityFilters(level, 0.4);
      },
      onPlayStateChange: (playing: boolean) => {
        isPlaying = playing;
        if (playing) {
          startWind();
        } else {
          stopWind(0.08);
        }
      },
      cleanup: () => {
        isPlaying = false;
        stopWind(0.02);
        try {
          gustLfo.stop();
          gustLfo.disconnect();
          trackGain.disconnect();
        } catch {}
      },
    };
  }

  // --- 5. FIREPLACE / FIRE TRACK (Костер) ---
  // light: 'ТЛЕНИЕ УГЛЕЙ' (процедурные тихие угли + теплый суб-гул)
  // moderate: 'ТРЕСК КОСТРА' (fire_crackling.mp3)
  // strong: 'ЯРКОЕ ПЛАМЯ' (fire_crackling.mp3 + глубокий суб-гул пламени)
  private buildFireplaceTrack(): AudioTrackInstance {
    const ctx = this.ctx!;
    const trackGain = ctx.createGain();
    trackGain.gain.setValueAtTime(0, ctx.currentTime);

    // Слой реального сэмпла треска костра
    const sampleGain = ctx.createGain();
    sampleGain.gain.setValueAtTime(0, ctx.currentTime);
    sampleGain.connect(trackGain);

    // Слой суб-гула пламени (коричневый шум через фильтр низких частот)
    const subGain = ctx.createGain();
    subGain.gain.setValueAtTime(0.2, ctx.currentTime);

    const subFilter = ctx.createBiquadFilter();
    subFilter.type = 'lowpass';
    subFilter.frequency.setValueAtTime(220, ctx.currentTime);
    subFilter.connect(subGain);
    subGain.connect(trackGain);

    // Процедурные угли для режима 'light'
    const embersGain = ctx.createGain();
    embersGain.gain.setValueAtTime(0.3, ctx.currentTime);
    embersGain.connect(trackGain);

    let sampleSource: AudioBufferSourceNode | null = null;
    let brownSource: AudioBufferSourceNode | null = null;
    let crackleTimer: number | null = null;

    let currentLevel: IntensityLevel = 'moderate';
    let isPlaying = this.isPlaying;

    let minCrackleMs = 200;
    let maxCrackleMs = 600;
    let cracklePopVolume = 0.08;

    const clearCrackleTimer = () => {
      if (crackleTimer !== null) {
        window.clearTimeout(crackleTimer);
        crackleTimer = null;
      }
    };

    // Органический щелчок тлеющего уголька
    const playEmberSnap = () => {
      if (!isPlaying || currentLevel !== 'light') return;
      const now = ctx.currentTime;
      const clickDuration = 0.02 + Math.random() * 0.025;
      const buffer = ctx.createBuffer(1, Math.floor(ctx.sampleRate * clickDuration), ctx.sampleRate);
      const data = buffer.getChannelData(0);

      for (let i = 0; i < data.length; i++) {
        const decay = Math.exp(-i / (data.length * 0.16));
        data[i] = (Math.random() * 2 - 1) * decay;
      }

      const snapSource = ctx.createBufferSource();
      snapSource.buffer = buffer;

      const snapFilter = ctx.createBiquadFilter();
      snapFilter.type = 'bandpass';
      snapFilter.frequency.setValueAtTime(1400 + Math.random() * 1200, now);
      snapFilter.Q.setValueAtTime(1.8, now);

      const snapGain = ctx.createGain();
      const popVol = (0.05 + Math.random() * 0.12) * cracklePopVolume;
      snapGain.gain.setValueAtTime(popVol, now);
      snapGain.gain.exponentialRampToValueAtTime(0.0001, now + clickDuration);

      snapSource.connect(snapFilter);
      snapFilter.connect(snapGain);
      snapGain.connect(embersGain);

      snapSource.start(now);
    };

    const scheduleCrackle = () => {
      clearCrackleTimer();
      if (!isPlaying || currentLevel !== 'light') return;
      const delay = minCrackleMs + Math.random() * (maxCrackleMs - minCrackleMs);
      crackleTimer = window.setTimeout(() => {
        playEmberSnap();
        if (Math.random() > 0.6) {
          window.setTimeout(() => playEmberSnap(), 30 + Math.random() * 40);
        }
        scheduleCrackle();
      }, delay);
    };

    const applyIntensityState = (level: IntensityLevel, fadeSec = 0.4) => {
      const now = ctx.currentTime;
      sampleGain.gain.cancelScheduledValues(now);
      sampleGain.gain.setValueAtTime(sampleGain.gain.value, now);

      subGain.gain.cancelScheduledValues(now);
      subGain.gain.setValueAtTime(subGain.gain.value, now);

      embersGain.gain.cancelScheduledValues(now);
      embersGain.gain.setValueAtTime(embersGain.gain.value, now);

      if (level === 'light') {
        // Тление углей: сэмпл треска плавно уходит, теплый легкий суб-гул + процедурные угли
        sampleGain.gain.linearRampToValueAtTime(0, now + fadeSec);
        subGain.gain.linearRampToValueAtTime(0.18, now + fadeSec);
        embersGain.gain.linearRampToValueAtTime(0.35, now + fadeSec);
        minCrackleMs = 280;
        maxCrackleMs = 700;
        cracklePopVolume = 0.7;
        scheduleCrackle();
      } else if (level === 'moderate') {
        // Треск костра: играет сэмпл, умеренный теплый гул
        sampleGain.gain.linearRampToValueAtTime(1.0, now + fadeSec);
        subGain.gain.linearRampToValueAtTime(0.22, now + fadeSec);
        embersGain.gain.linearRampToValueAtTime(0, now + fadeSec);
        clearCrackleTimer();
      } else {
        // Яркое пламя: играет сэмпл + глубокий сочный суб-гул ревущего огня
        sampleGain.gain.linearRampToValueAtTime(1.0, now + fadeSec);
        subGain.gain.linearRampToValueAtTime(0.55, now + fadeSec);
        embersGain.gain.linearRampToValueAtTime(0, now + fadeSec);
        clearCrackleTimer();
      }
    };

    const startFire = () => {
      if (!isPlaying) return;

      // 1. Старт процедурного суб-гула пламени
      if (!brownSource && this.brownBuffer) {
        const bSource = ctx.createBufferSource();
        bSource.buffer = this.brownBuffer;
        bSource.loop = true;
        bSource.connect(subFilter);
        bSource.start();
        brownSource = bSource;
      }

      // 2. Старт сэмпла треска костра
      if (!sampleSource) {
        const url = '/audio/fire_crackling.mp3';
        const startSample = (buffer: AudioBuffer) => {
          if (!isPlaying || sampleSource) return;
          const s = ctx.createBufferSource();
          s.buffer = buffer;
          s.loop = true;
          s.connect(sampleGain);

          const offset = Math.random() * Math.max(0, buffer.duration - 1);
          s.start(ctx.currentTime, offset);
          sampleSource = s;
        };

        const cached = soundCache.getBuffer(url);
        if (cached) {
          startSample(cached);
        } else {
          soundCache
            .loadLoopBuffer(ctx, url)
            .then((b) => startSample(b))
            .catch((err) => console.warn('[FireplaceTrack] Failed to load crackling sample:', err));
        }
      }

      applyIntensityState(currentLevel, 0.2);
    };

    const stopFire = (fadeSec = 0.08) => {
      clearCrackleTimer();
      const now = ctx.currentTime;

      sampleGain.gain.cancelScheduledValues(now);
      sampleGain.gain.setValueAtTime(sampleGain.gain.value, now);
      sampleGain.gain.linearRampToValueAtTime(0, now + fadeSec);

      subGain.gain.cancelScheduledValues(now);
      subGain.gain.setValueAtTime(subGain.gain.value, now);
      subGain.gain.linearRampToValueAtTime(0, now + fadeSec);

      const sSource = sampleSource;
      const bSource = brownSource;
      sampleSource = null;
      brownSource = null;

      window.setTimeout(() => {
        try {
          sSource?.stop();
          sSource?.disconnect();
          bSource?.stop();
          bSource?.disconnect();
        } catch {}
      }, Math.ceil((fadeSec + 0.05) * 1000));
    };

    return {
      masterGain: trackGain,
      setIntensity: (level: IntensityLevel) => {
        currentLevel = level;
        if (isPlaying) {
          applyIntensityState(level, 0.4);
        }
      },
      onPlayStateChange: (playing: boolean) => {
        isPlaying = playing;
        if (playing) {
          startFire();
        } else {
          stopFire(0.08);
        }
      },
      cleanup: () => {
        isPlaying = false;
        stopFire(0.02);
        try {
          trackGain.disconnect();
        } catch {}
      },
    };
  }

  // --- 6. THUNDER TRACK (Сохраненный глубокий процедурный гром) ---
  // Естественные раскаты с суб-басовым инфра-гулом (pitch drop 55->32Hz) + filtered brown noise с эхом
  private buildThunderTrack(): AudioTrackInstance {
    const ctx = this.ctx!;
    const trackGain = ctx.createGain();
    trackGain.gain.setValueAtTime(0, ctx.currentTime);

    let thunderTimer: number | null = null;
    let minIntervalMs = 15000;
    let maxIntervalMs = 28000;
    let lowpassCutoff = 180;
    let thunderRumbleGain = 0.8;

    const clearThunderTimer = () => {
      if (thunderTimer !== null) {
        window.clearTimeout(thunderTimer);
        thunderTimer = null;
      }
    };

    const triggerThunder = () => {
      if (!this.isPlaying) return;
      const now = ctx.currentTime;
      const duration = 5.0 + Math.random() * 3.5;

      // 1. Sub-bass infra oscillator (55Hz -> 32Hz pitch drop)
      const subOsc = ctx.createOscillator();
      subOsc.type = 'sine';
      subOsc.frequency.setValueAtTime(55, now);
      subOsc.frequency.exponentialRampToValueAtTime(32, now + 3.0);

      const subGain = ctx.createGain();
      subGain.gain.setValueAtTime(0.001, now);
      subGain.gain.linearRampToValueAtTime(0.6 * thunderRumbleGain, now + 0.25);
      subGain.gain.exponentialRampToValueAtTime(0.0001, now + duration * 0.8);

      subOsc.connect(subGain);
      subGain.connect(trackGain);

      // 2. Filtered brown noise body
      if (!this.brownBuffer) return;
      const thunderSource = ctx.createBufferSource();
      thunderSource.buffer = this.brownBuffer;
      thunderSource.loop = true;

      const thunderGain = ctx.createGain();
      thunderGain.gain.setValueAtTime(0.001, now);

      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(lowpassCutoff, now);
      filter.Q.setValueAtTime(2.5, now);

      // Tremolo LFO for rolling wave texture
      const lfo = ctx.createOscillator();
      lfo.frequency.setValueAtTime(3.5 + Math.random() * 4, now);
      const lfoGain = ctx.createGain();
      lfoGain.gain.setValueAtTime(lowpassCutoff * 0.35, now);
      lfo.connect(filter.frequency);

      // Echo / reverb feedback delay simulation
      const delayNode = ctx.createDelay();
      delayNode.delayTime.setValueAtTime(0.18 + Math.random() * 0.08, now);
      const feedbackGain = ctx.createGain();
      feedbackGain.gain.setValueAtTime(0.35, now);

      delayNode.connect(feedbackGain);
      feedbackGain.connect(delayNode);
      delayNode.connect(trackGain);

      thunderSource.connect(filter);
      filter.connect(thunderGain);
      thunderGain.connect(trackGain);
      thunderGain.connect(delayNode);

      // Envelope
      const attack = 0.2 + Math.random() * 0.3;
      thunderGain.gain.linearRampToValueAtTime(0.85 * thunderRumbleGain, now + attack);
      thunderGain.gain.exponentialRampToValueAtTime(0.001, now + duration);

      thunderSource.start(now);
      lfo.start(now);
      subOsc.start(now);

      thunderSource.stop(now + duration + 0.3);
      lfo.stop(now + duration + 0.3);
      subOsc.stop(now + duration + 0.3);
    };

    const scheduleNext = () => {
      clearThunderTimer();
      if (!this.isPlaying) return;
      const delay = minIntervalMs + Math.random() * (maxIntervalMs - minIntervalMs);
      thunderTimer = window.setTimeout(() => {
        triggerThunder();
        scheduleNext();
      }, delay);
    };

    const setIntensity = (level: IntensityLevel) => {
      if (level === 'light') {
        minIntervalMs = 20000;
        maxIntervalMs = 38000;
        lowpassCutoff = 130;
        thunderRumbleGain = 0.55;
      } else if (level === 'moderate') {
        minIntervalMs = 12000;
        maxIntervalMs = 24000;
        lowpassCutoff = 210;
        thunderRumbleGain = 0.85;
      } else {
        minIntervalMs = 6000;
        maxIntervalMs = 13000;
        lowpassCutoff = 360;
        thunderRumbleGain = 1.1;
      }
    };

    return {
      masterGain: trackGain,
      setIntensity,
      onPlayStateChange: (playing: boolean) => {
        if (playing) {
          scheduleNext();
        } else {
          clearThunderTimer();
        }
      },
      cleanup: () => {
        clearThunderTimer();
      },
    };
  }

  public destroy() {
    this.tracks.forEach((track) => track.cleanup());
    this.tracks.clear();
    soundCache.clear();
    if (this.ctx) {
      this.ctx.close();
      this.ctx = null;
    }
  }
}

export const audioEngine = new AudioEngine();
