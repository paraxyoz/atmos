import React, { useState, useEffect, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { audioEngine, IntensityLevel } from './audio/AudioEngine';
import { TRACK_CONFIGS, ACCENT_COLORS, AccentColor, SOUND_PRESETS } from './config';

interface TrackState {
  volume: number; // 0..100
  intensity: IntensityLevel;
  active: boolean;
}

export type BackgroundTheme = 'acrylic' | 'dark';

export const App: React.FC = () => {
  // Master state
  const [isPlaying, setIsPlaying] = useState<boolean>(() => {
    const saved = localStorage.getItem('atmos_isPlaying');
    return saved !== null ? JSON.parse(saved) : true;
  });
  const [masterVolume, setMasterVolume] = useState<number>(() => {
    const saved = localStorage.getItem('atmos_masterVolume');
    return saved !== null ? JSON.parse(saved) : 40;
  });
  const [isMuted, setIsMuted] = useState<boolean>(false);
  const [previousMasterVolume, setPreviousMasterVolume] = useState<number>(40);

  // Background Theme state ('acrylic' | 'dark')
  const [bgTheme, setBgTheme] = useState<BackgroundTheme>(() => {
    const saved = localStorage.getItem('atmos_bgTheme');
    return saved === 'dark' || saved === 'acrylic' ? (saved as BackgroundTheme) : 'acrylic';
  });

  // Sound Preset state
  const [currentPresetIndex, setCurrentPresetIndex] = useState<number>(() => {
    const saved = localStorage.getItem('atmos_presetIndex');
    if (saved !== null) {
      const idx = parseInt(saved, 10);
      if (!isNaN(idx) && idx >= 0 && idx < SOUND_PRESETS.length) return idx;
    }
    return 0;
  });

  // Selected Accent Color
  const [accent, setAccent] = useState<AccentColor>(() => {
    const savedId = localStorage.getItem('atmos_accentId');
    const found = ACCENT_COLORS.find((c) => c.id === savedId);
    return found || ACCENT_COLORS[0];
  });
  const [showColorPicker, setShowColorPicker] = useState<boolean>(false);

  // Timer State
  const [timerMinutes, setTimerMinutes] = useState<number | null>(null);
  const [timerRemainingSeconds, setTimerRemainingSeconds] = useState<number | null>(null);
  const [showTimerMenu, setShowTimerMenu] = useState<boolean>(false);

  // Tracks State
  const [tracksState, setTracksState] = useState<Record<string, TrackState>>(() => {
    const saved = localStorage.getItem('atmos_tracksState');
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        // Обратная совместимость fire <-> fireplace
        if (parsed.fire && !parsed.fireplace) {
          parsed.fireplace = parsed.fire;
        } else if (parsed.fireplace && !parsed.fire) {
          parsed.fire = parsed.fireplace;
        }
        // Гарантируем наличие всех каналов из TRACK_CONFIGS
        TRACK_CONFIGS.forEach((track) => {
          if (!parsed[track.id]) {
            parsed[track.id] = {
              volume: track.defaultVolume,
              intensity: 'moderate',
              active: false,
            };
          }
        });
        return parsed;
      } catch {}
    }
    const initial: Record<string, TrackState> = {};
    const defaultPreset = SOUND_PRESETS[0];
    TRACK_CONFIGS.forEach((track) => {
      const presetTrack = defaultPreset?.tracks[track.id];
      initial[track.id] = {
        volume: presetTrack ? presetTrack.volume : track.defaultVolume,
        intensity: presetTrack ? presetTrack.intensity : 'moderate',
        active: presetTrack ? presetTrack.active : false,
      };
    });
    return initial;
  });

  const timerEndTimestampRef = useRef<number | null>(null);
  const timerRemainingMsRef = useRef<number | null>(null);

  // Resume AudioContext on first user interaction to handle autoplay restrictions
  useEffect(() => {
    const handleFirstInteraction = () => {
      audioEngine.resumeContext();
    };

    window.addEventListener('pointerdown', handleFirstInteraction, { once: true });
    window.addEventListener('keydown', handleFirstInteraction, { once: true });
    window.addEventListener('click', handleFirstInteraction, { once: true });
    window.addEventListener('focus', handleFirstInteraction);

    return () => {
      window.removeEventListener('pointerdown', handleFirstInteraction);
      window.removeEventListener('keydown', handleFirstInteraction);
      window.removeEventListener('click', handleFirstInteraction);
      window.removeEventListener('focus', handleFirstInteraction);
    };
  }, []);

  // Save state to localStorage
  useEffect(() => {
    localStorage.setItem('atmos_isPlaying', JSON.stringify(isPlaying));
  }, [isPlaying]);

  useEffect(() => {
    localStorage.setItem('atmos_masterVolume', JSON.stringify(masterVolume));
  }, [masterVolume]);

  useEffect(() => {
    localStorage.setItem('atmos_accentId', accent.id);
  }, [accent]);

  useEffect(() => {
    localStorage.setItem('atmos_bgTheme', bgTheme);
    invoke('set_window_vibrancy', { theme: bgTheme }).catch(() => {});
  }, [bgTheme]);

  useEffect(() => {
    localStorage.setItem('atmos_presetIndex', currentPresetIndex.toString());
  }, [currentPresetIndex]);

  useEffect(() => {
    localStorage.setItem('atmos_tracksState', JSON.stringify(tracksState));
  }, [tracksState]);

  // Sync Master Volume & Playback to AudioEngine
  useEffect(() => {
    if (isPlaying) {
      audioEngine.start();
    } else {
      audioEngine.pause();
    }
  }, [isPlaying]);

  useEffect(() => {
    audioEngine.setMasterVolume(masterVolume);
  }, [masterVolume]);

  useEffect(() => {
    audioEngine.setMuted(isMuted);
  }, [isMuted]);

  // Sync Tracks to AudioEngine
  useEffect(() => {
    TRACK_CONFIGS.forEach((cfg) => {
      const state = tracksState[cfg.id];
      if (state) {
        audioEngine.setTrackIntensity(cfg.id, state.intensity);
        const actualVol = state.active ? state.volume : 0;
        audioEngine.setTrackVolume(cfg.id, actualVol);
      }
    });
  }, [tracksState]);

  // Handle pause/resume for sleep timer based on wall-clock time
  useEffect(() => {
    if (timerMinutes === null) return;

    if (!isPlaying) {
      if (timerEndTimestampRef.current !== null) {
        const remaining = Math.max(0, timerEndTimestampRef.current - Date.now());
        timerRemainingMsRef.current = remaining;
        timerEndTimestampRef.current = null;
        setTimerRemainingSeconds(Math.ceil(remaining / 1000));
      }
    } else {
      if (timerRemainingMsRef.current !== null) {
        timerEndTimestampRef.current = Date.now() + timerRemainingMsRef.current;
        timerRemainingMsRef.current = null;
      }
    }
  }, [isPlaying, timerMinutes]);

  // Sleep Timer countdown based on Date.now()
  useEffect(() => {
    if (timerMinutes === null || !isPlaying) return;

    const checkTimer = () => {
      if (!timerEndTimestampRef.current) return;
      const remainingMs = timerEndTimestampRef.current - Date.now();
      if (remainingMs <= 0) {
        setIsPlaying(false);
        setTimerMinutes(null);
        setTimerRemainingSeconds(null);
        timerEndTimestampRef.current = null;
        timerRemainingMsRef.current = null;
      } else {
        setTimerRemainingSeconds(Math.ceil(remainingMs / 1000));
      }
    };

    checkTimer();
    const intervalId = window.setInterval(checkTimer, 500);
    return () => window.clearInterval(intervalId);
  }, [timerMinutes, isPlaying]);

  // Preset switching logic (LMB forward, RMB backward)
  const applyPreset = (index: number) => {
    const preset = SOUND_PRESETS[index];
    if (!preset) return;
    setCurrentPresetIndex(index);

    setTracksState((prev) => {
      const nextState: Record<string, TrackState> = { ...prev };
      TRACK_CONFIGS.forEach((track) => {
        const presetTrack = preset.tracks[track.id];
        if (presetTrack) {
          nextState[track.id] = {
            volume: presetTrack.volume,
            intensity: presetTrack.intensity,
            active: presetTrack.active,
          };
        } else {
          nextState[track.id] = {
            volume: track.defaultVolume,
            intensity: 'moderate',
            active: false,
          };
        }
      });
      return nextState;
    });
  };

  const nextPreset = () => {
    audioEngine.resumeContext();
    const nextIndex = (currentPresetIndex + 1) % SOUND_PRESETS.length;
    applyPreset(nextIndex);
  };

  const prevPreset = () => {
    audioEngine.resumeContext();
    const prevIndex = (currentPresetIndex - 1 + SOUND_PRESETS.length) % SOUND_PRESETS.length;
    applyPreset(prevIndex);
  };

  // Cycle Intensity: light -> moderate -> strong -> light
  const cycleIntensity = (trackId: string) => {
    audioEngine.resumeContext();
    setTracksState((prev) => {
      const current = prev[trackId];
      if (!current) return prev;
      let next: IntensityLevel = 'moderate';
      if (current.intensity === 'light') next = 'moderate';
      else if (current.intensity === 'moderate') next = 'strong';
      else next = 'light';

      return {
        ...prev,
        [trackId]: {
          ...current,
          intensity: next,
        },
      };
    });
  };

  const handleVolumeChange = (trackId: string, val: number) => {
    audioEngine.resumeContext();
    setTracksState((prev) => {
      const current = prev[trackId];
      if (!current) return prev;
      return {
        ...prev,
        [trackId]: {
          ...current,
          volume: val,
          active: val > 0 ? true : current.active,
        },
      };
    });
  };

  // Wheel volume control for individual tracks
  const handleVolumeWheel = (trackId: string, deltaY: number) => {
    setTracksState((prev) => {
      const current = prev[trackId];
      if (!current) return prev;
      const step = deltaY < 0 ? 5 : -5;
      const newVolume = Math.max(0, Math.min(100, current.volume + step));
      return {
        ...prev,
        [trackId]: {
          ...current,
          volume: newVolume,
          active: newVolume > 0 ? true : current.active,
        },
      };
    });
  };

  // Wheel volume control for Master Volume
  const handleMasterWheel = (deltaY: number) => {
    const step = deltaY < 0 ? 5 : -5;
    const newVolume = Math.max(0, Math.min(100, masterVolume + step));
    handleMasterVolumeChange(newVolume);
  };

  const toggleTrackActive = (trackId: string) => {
    audioEngine.resumeContext();
    setTracksState((prev) => {
      const current = prev[trackId];
      if (!current) return prev;
      const nextActive = !current.active;
      return {
        ...prev,
        [trackId]: {
          ...current,
          active: nextActive,
        },
      };
    });
  };

  const handleMasterVolumeChange = (val: number) => {
    audioEngine.resumeContext();
    setMasterVolume(val);
    if (val > 0 && isMuted) {
      setIsMuted(false);
    }
  };

  const toggleMute = () => {
    if (isMuted) {
      setIsMuted(false);
      if (masterVolume === 0) setMasterVolume(previousMasterVolume || 40);
    } else {
      setPreviousMasterVolume(masterVolume);
      setIsMuted(true);
    }
  };

  const startSleepTimer = (minutes: number) => {
    setTimerMinutes(minutes);
    const totalSeconds = minutes * 60;
    setTimerRemainingSeconds(totalSeconds);
    timerEndTimestampRef.current = Date.now() + totalSeconds * 1000;
    timerRemainingMsRef.current = null;
    setShowTimerMenu(false);
  };

  const cancelSleepTimer = () => {
    setTimerMinutes(null);
    setTimerRemainingSeconds(null);
    timerEndTimestampRef.current = null;
    timerRemainingMsRef.current = null;
    setShowTimerMenu(false);
  };

  const formatTimerLabel = () => {
    if (timerRemainingSeconds === null) return 'Без таймера';
    const m = Math.floor(timerRemainingSeconds / 60);
    const s = timerRemainingSeconds % 60;
    return `Таймер: ${m}:${s < 10 ? '0' : ''}${s}`;
  };

  const minimizeToTray = async () => {
    try {
      await invoke('hide_window');
    } catch {
      try {
        const { getCurrentWindow } = await import('@tauri-apps/api/window');
        await getCurrentWindow().hide();
      } catch (err) {
        console.error('Failed to hide window:', err);
      }
    }
  };

  const exitApp = async () => {
    try {
      await invoke('exit_app');
    } catch {
      window.close();
    }
  };

  const currentPreset = SOUND_PRESETS[currentPresetIndex] || SOUND_PRESETS[0];

  return (
    <div
      onWheel={(e) => handleMasterWheel(e.deltaY)}
      className="w-full h-full flex flex-col justify-between p-4 box-border select-none overflow-hidden relative rounded-[12px]"
      style={{
        background:
          bgTheme === 'acrylic'
            ? 'rgba(18, 22, 30, 0.65)'
            : 'linear-gradient(145deg, #161b26 0%, #0f131a 100%)',
        border:
          bgTheme === 'acrylic'
            ? '1px solid rgba(255, 255, 255, 0.12)'
            : '1px solid rgba(255, 255, 255, 0.08)',
        boxShadow:
          '0 20px 50px -10px rgba(0, 0, 0, 0.8), inset 0 1px 1px 0 rgba(255, 255, 255, 0.14)',
      }}
    >
      {/* Header */}
      <div className="flex items-center justify-between pb-1" data-tauri-drag-region>
        <div className="flex items-center gap-3">
          {/* Back / Minimize Chevron Button */}
          <button
            onClick={minimizeToTray}
            className="w-8 h-8 rounded-full bg-white/[0.06] hover:bg-white/[0.14] text-white/90 flex items-center justify-center transition-all active:scale-95 border border-white/5 cursor-pointer"
            title="Свернуть в трей"
          >
            <span className="material-symbols-outlined text-[19px]">chevron_left</span>
          </button>

          {/* Interactive Preset Switcher */}
          <div className="flex flex-col select-none">
            <div
              onClick={nextPreset}
              onContextMenu={(e) => {
                e.preventDefault();
                prevPreset();
              }}
              title="ЛКМ: следующий пресет • ПКМ: предыдущий"
              className="flex items-center gap-1.5 cursor-pointer group hover:opacity-90 active:scale-[0.98] transition-all"
            >
              <span className="text-[14px] font-semibold tracking-tight text-white leading-tight group-hover:text-white transition-colors">
                {currentPreset.name}
              </span>
              <span
                className="text-[10px] font-medium px-1.5 py-0.2 rounded-md bg-white/[0.08] group-hover:bg-white/[0.14] transition-colors"
                style={{ color: accent.hex }}
              >
                {currentPresetIndex + 1}/{SOUND_PRESETS.length}
              </span>
            </div>
            <span className="text-[11px] text-white/50 tracking-normal font-normal">
              {formatTimerLabel()}
            </span>
          </div>
        </div>

        {/* Header Right Actions: Settings & Close */}
        <div className="flex items-center gap-1">
          {/* Color Palette & Settings Toggle */}
          <div className="relative">
            <button
              onClick={() => setShowColorPicker(!showColorPicker)}
              className="w-8 h-8 rounded-full flex items-center justify-center text-white/50 hover:text-white/90 hover:bg-white/[0.06] transition-all"
              title="Выбор стиля"
            >
              <span className="material-symbols-outlined text-[19px]">palette</span>
            </button>

            {/* Color & Theme Settings Popover */}
            {showColorPicker && (
              <>
                <div
                  className="fixed inset-0 z-40"
                  onClick={() => setShowColorPicker(false)}
                />
                <div className="absolute right-0 top-10 bg-[#161a22] border border-white/10 rounded-xl p-2.5 shadow-2xl flex flex-col gap-2.5 z-50 min-w-[190px]">
                  {/* Background theme selector */}
                  <span className="text-[10px] text-white/50 uppercase tracking-wider font-semibold px-1">
                    Фон приложения
                  </span>
                  <div className="flex flex-col gap-1">
                    <button
                      onClick={() => setBgTheme('acrylic')}
                      className={`flex items-center justify-between px-2.5 py-1.5 rounded-lg text-[12px] font-medium transition-all ${
                        bgTheme === 'acrylic'
                          ? 'bg-white/15 text-white shadow-sm'
                          : 'text-white/70 hover:bg-white/5 hover:text-white'
                      }`}
                    >
                      <div className="flex items-center gap-2">
                        <span className="material-symbols-outlined text-[16px]" style={{ color: accent.hex }}>
                          blur_on
                        </span>
                        <span>Размытие (Стекло)</span>
                      </div>
                      {bgTheme === 'acrylic' && (
                        <span className="material-symbols-outlined text-[14px]">check</span>
                      )}
                    </button>

                    <button
                      onClick={() => setBgTheme('dark')}
                      className={`flex items-center justify-between px-2.5 py-1.5 rounded-lg text-[12px] font-medium transition-all ${
                        bgTheme === 'dark'
                          ? 'bg-white/15 text-white shadow-sm'
                          : 'text-white/70 hover:bg-white/5 hover:text-white'
                      }`}
                    >
                      <div className="flex items-center gap-2">
                        <span className="material-symbols-outlined text-[16px]" style={{ color: accent.hex }}>
                          dark_mode
                        </span>
                        <span>Темная тема</span>
                      </div>
                      {bgTheme === 'dark' && (
                        <span className="material-symbols-outlined text-[14px]">check</span>
                      )}
                    </button>
                  </div>

                  <div className="h-px bg-white/10 mx-0.5" />

                  {/* Accent Color */}
                  <span className="text-[10px] text-white/50 uppercase tracking-wider font-semibold px-1">
                    Акцентный цвет
                  </span>
                  <div className="flex items-center justify-between px-1 py-0.5">
                    {ACCENT_COLORS.map((c) => (
                      <button
                        key={c.id}
                        onClick={() => {
                          setAccent(c);
                        }}
                        style={{ backgroundColor: c.hex }}
                        className={`w-5 h-5 rounded-full transition-transform hover:scale-110 ${
                          accent.id === c.id ? 'ring-2 ring-white ring-offset-2 ring-offset-[#161a22] scale-110' : ''
                        }`}
                        title={c.name}
                      />
                    ))}
                  </div>
                </div>
              </>
            )}
          </div>

          {/* Close button (Exits the app completely) */}
          <button
            onClick={exitApp}
            className="w-8 h-8 rounded-full flex items-center justify-center text-red-400 hover:text-white hover:bg-red-500/80 transition-all active:scale-95 cursor-pointer border border-red-500/20 hover:border-red-500/40 group"
            title="Закрыть приложение"
          >
            <span className="material-symbols-outlined text-[18px] group-hover:rotate-90 transition-transform duration-200">close</span>
          </button>
        </div>
      </div>

      {/* Audio Tracks List: py-3 and -mx-3 px-3.5 prevents edge clipping of glow effects */}
      <div className="flex-1 flex flex-col gap-4 my-1 overflow-y-auto -mx-3 px-3.5 py-3">
        {TRACK_CONFIGS.map((track) => {
          const state = tracksState[track.id] || {
            volume: track.defaultVolume,
            intensity: 'moderate',
            active: false,
          };
          const isTrackActive = state.active && isPlaying && !isMuted && masterVolume > 0 && state.volume > 0;

          return (
            <div
              key={track.id}
              onWheel={(e) => {
                e.stopPropagation();
                handleVolumeWheel(track.id, e.deltaY);
              }}
              className="flex items-center gap-4 group sound-channel first:mt-1 last:mb-1"
            >
              {/* Icon badge: Click toggles active state */}
              <button
                onClick={() => toggleTrackActive(track.id)}
                className={`w-10 h-10 rounded-full flex items-center justify-center shrink-0 transition-all duration-300 group-hover:scale-105 active:scale-95 relative ${
                  isTrackActive ? 'icon-glow-active' : ''
                }`}
                style={
                  {
                    '--accent-glow': `${accent.hex}88`,
                    backgroundColor: isTrackActive ? `${accent.hex}22` : `${accent.hex}10`,
                    border: `1px solid ${accent.hex}${isTrackActive ? '66' : '22'}`,
                    color: isTrackActive ? accent.hex : '#ffffff77',
                    opacity: state.active ? 1 : 0.45,
                  } as React.CSSProperties
                }
                title={state.active ? 'Выключить звук' : 'Включить звук'}
              >
                <span className="material-symbols-outlined text-[19px]">{track.icon}</span>
              </button>

              {/* Track Content & Slider */}
              <div className="flex-1 flex flex-col gap-1.5">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span
                      onClick={() => toggleTrackActive(track.id)}
                      className={`text-[13px] font-medium cursor-pointer transition-colors ${
                        state.active ? 'text-white/95' : 'text-white/50'
                      }`}
                    >
                      {track.name}
                    </span>

                    {/* Animated Equalizer bars */}
                    {isTrackActive ? (
                      <div className="flex items-end gap-[2px] h-[12px] px-1 py-0.5" title="Воспроизводится">
                        <span
                          className="w-[2.5px] rounded-full eq-bar-1 transition-all"
                          style={{ backgroundColor: accent.hex }}
                        />
                        <span
                          className="w-[2.5px] rounded-full eq-bar-2 transition-all"
                          style={{ backgroundColor: accent.hex }}
                        />
                        <span
                          className="w-[2.5px] rounded-full eq-bar-3 transition-all"
                          style={{ backgroundColor: accent.hex }}
                        />
                        <span
                          className="w-[2.5px] rounded-full eq-bar-4 transition-all"
                          style={{ backgroundColor: accent.hex }}
                        />
                      </div>
                    ) : (
                      <div className="flex items-end gap-[2px] h-[12px] px-1 py-0.5 opacity-20">
                        <span className="w-[2.5px] h-[2px] rounded-full bg-white/40" />
                        <span className="w-[2.5px] h-[2px] rounded-full bg-white/40" />
                        <span className="w-[2.5px] h-[2px] rounded-full bg-white/40" />
                        <span className="w-[2.5px] h-[2px] rounded-full bg-white/40" />
                      </div>
                    )}
                  </div>

                  {/* Intensity Badge (Click cycles intensity with bouncy micro-transition) */}
                  <button
                    onClick={() => cycleIntensity(track.id)}
                    className="text-[10px] font-medium tracking-wider px-2 py-0.5 rounded-full bg-white/[0.04] hover:bg-white/[0.12] transition-all duration-200 active:scale-90 cursor-pointer border border-white/5"
                    style={{
                      color: isTrackActive ? accent.hex : '#ffffff77',
                      borderColor: isTrackActive ? `${accent.hex}33` : 'rgba(255,255,255,0.06)',
                    }}
                    title="Нажмите для смены интенсивности"
                  >
                    {track.intensityLabels[state.intensity]}
                  </button>
                </div>

                {/* Instant Tactile Slider (No CSS lag/transition) */}
                <div className="relative w-full flex items-center py-1">
                  <div className="w-full h-[3px] bg-white/[0.14] rounded-full relative overflow-hidden pointer-events-none">
                    <div
                      className="slider-fill h-full rounded-full"
                      style={{
                        backgroundColor: accent.hex,
                        width: `${state.volume}%`,
                        opacity: state.active ? 1 : 0.4,
                      }}
                    />
                  </div>

                  <input
                    type="range"
                    min="0"
                    max="100"
                    value={state.volume}
                    onChange={(e) => handleVolumeChange(track.id, Number(e.target.value))}
                    className="slider-input absolute inset-0 w-full opacity-0 cursor-pointer"
                  />

                  {/* Tactile Pill Knob: bounded inside track [0px .. 100% - 26px] */}
                  <div
                    className="thumb-knob absolute w-[26px] h-[12px] rounded-full bg-white border border-white/40 shadow-[0_2px_8px_rgba(0,0,0,0.35)] pointer-events-none"
                    style={{
                      left: `calc((${state.volume} / 100) * (100% - 26px))`,
                    }}
                  />
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Bottom Master Controls Bar */}
      <div
        onWheel={(e) => {
          e.stopPropagation();
          handleMasterWheel(e.deltaY);
        }}
        className="pt-2 border-t border-white/[0.08] flex items-center gap-3 relative"
      >
        {/* Play/Pause Toggle with gentle breath ripple */}
        <button
          onClick={() => {
            audioEngine.resumeContext();
            setIsPlaying(!isPlaying);
          }}
          className={`w-8 h-8 rounded-full flex items-center justify-center hover:text-white transition-all active:scale-95 ${
            isPlaying ? 'btn-play-pulse' : ''
          }`}
          style={{
            color: accent.hex,
            backgroundColor: `${accent.hex}18`,
            border: `1px solid ${accent.hex}33`,
          }}
          title={isPlaying ? 'Пауза' : 'Воспроизведение'}
        >
          <span className="material-symbols-outlined text-[20px]">
            {isPlaying ? 'pause' : 'play_arrow'}
          </span>
        </button>

        {/* Speaker / Mute Icon */}
        <button
          onClick={toggleMute}
          className="w-6 h-6 flex items-center justify-center text-white/70 hover:text-white transition-colors active:scale-95"
          title={isMuted ? 'Включить звук' : 'Заглушить'}
        >
          <span className="material-symbols-outlined text-[19px]">
            {isMuted || masterVolume === 0
              ? 'volume_off'
              : masterVolume < 40
              ? 'volume_down'
              : 'volume_up'}
          </span>
        </button>

        {/* Master Volume Slider Track (Instant response without transitions) */}
        <div className="relative flex-1 flex items-center py-1">
          <div className="w-full h-[3px] bg-white/[0.14] rounded-full relative overflow-hidden pointer-events-none">
            <div
              className="slider-fill h-full rounded-full"
              style={{
                backgroundColor: accent.hex,
                width: `${isMuted ? 0 : masterVolume}%`,
              }}
            />
          </div>
          <input
            type="range"
            min="0"
            max="100"
            value={isMuted ? 0 : masterVolume}
            onChange={(e) => handleMasterVolumeChange(Number(e.target.value))}
            className="absolute inset-0 w-full opacity-0 cursor-pointer"
          />
          {/* Tactile Pill Knob: bounded inside track [0px .. 100% - 26px] */}
          <div
            className="thumb-knob absolute w-[26px] h-[12px] rounded-full bg-white border border-white/40 shadow-[0_2px_8px_rgba(0,0,0,0.35)] pointer-events-none"
            style={{
              left: `calc((${isMuted ? 0 : masterVolume} / 100) * (100% - 26px))`,
            }}
          />
        </div>

        {/* Sleep Timer Toggle */}
        <div className="relative">
          <button
            onClick={() => setShowTimerMenu(!showTimerMenu)}
            className={`w-7 h-7 rounded-lg flex items-center justify-center hover:text-white transition-all active:scale-95 ${
              timerRemainingSeconds !== null ? 'text-white scale-105 bg-white/10' : ''
            }`}
            style={{ color: timerRemainingSeconds !== null ? '#ffffff' : accent.hex }}
            title="Таймер сна"
          >
            <span className="material-symbols-outlined text-[20px]">timer</span>
          </button>

          {/* Sleep Timer Menu */}
          {showTimerMenu && (
            <>
              <div
                className="fixed inset-0 z-40"
                onClick={() => setShowTimerMenu(false)}
              />
              <div className="absolute right-0 bottom-9 bg-[#161a22] border border-white/10 rounded-xl p-2 shadow-2xl flex flex-col gap-1.5 z-50 min-w-[130px]">
                <span className="text-[10px] text-white/50 uppercase tracking-wider font-semibold px-2">
                  Таймер сна
                </span>
                {[15, 30, 45, 60].map((mins) => (
                  <button
                    key={mins}
                    onClick={() => startSleepTimer(mins)}
                    className={`text-left text-[12px] px-2 py-1 rounded transition-colors ${
                      timerMinutes === mins
                        ? 'bg-white/20 text-white font-medium'
                        : 'text-white/80 hover:bg-white/10'
                    }`}
                  >
                    {mins} минут
                  </button>
                ))}
                {timerRemainingSeconds !== null && (
                  <button
                    onClick={cancelSleepTimer}
                    className="text-left text-[11px] text-red-400 hover:bg-red-400/10 px-2 py-1 rounded transition-colors border-t border-white/5 mt-1"
                  >
                    Выключить таймер
                  </button>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
};

export default App;
