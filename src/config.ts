import { SoundTrackConfig, IntensityLevel } from './audio/AudioEngine';

export interface AccentColor {
  id: string;
  name: string;
  hex: string;
  twClass: string;
}

export const ACCENT_COLORS: AccentColor[] = [
  { id: 'amber', name: 'Янтарный', hex: '#e2c499', twClass: 'bg-[#e2c499]' },
  { id: 'mint', name: 'Мятный', hex: '#99e2b4', twClass: 'bg-[#99e2b4]' },
  { id: 'azure', name: 'Лазурный', hex: '#99cfe2', twClass: 'bg-[#99cfe2]' },
  { id: 'rose', name: 'Розовый', hex: '#e299b8', twClass: 'bg-[#e299b8]' },
];

export const ALL_SAMPLE_URLS: string[] = [
  '/audio/rain_roof.mp3',
  '/audio/rain_tropical.mp3',
  '/audio/rain_heavy_forest.mp3',
  '/audio/ocean_beach.mp3',
  '/audio/ocean_rocky.mp3',
  '/audio/ocean_rocks.mp3',
  '/audio/wind_day.mp3',
  '/audio/forest_night.mp3',
  '/audio/forest_birds.mp3',
  '/audio/stream_forest.mp3',
  '/audio/fire_crackling.mp3',
  '/audio/train_soft.mp3',
  '/audio/train_wagon.mp3',
];

export const TRACK_CONFIGS: SoundTrackConfig[] = [
  {
    id: 'rain',
    name: 'Дождь',
    icon: 'rainy',
    defaultVolume: 38,
    intensityLabels: {
      light: 'ПО КРЫШЕ',
      moderate: 'ТРОПИЧЕСКИЙ',
      strong: 'ЛИВЕНЬ',
    },
    sampleUrls: {
      light: '/audio/rain_roof.mp3',
      moderate: '/audio/rain_tropical.mp3',
      strong: '/audio/rain_heavy_forest.mp3',
    },
  },
  {
    id: 'thunder',
    name: 'Гром',
    icon: 'thunderstorm',
    defaultVolume: 35,
    intensityLabels: {
      light: 'ДАЛЕКИЙ',
      moderate: 'РАСКАТЫ',
      strong: 'ГРОЗА',
    },
  },
  {
    id: 'ocean',
    name: 'Морские волны',
    icon: 'tsunami',
    defaultVolume: 38,
    intensityLabels: {
      light: 'ПЛЯЖ',
      moderate: 'КАМЕННЫЙ БЕРЕГ',
      strong: 'ПРИБОЙ О СКАЛЫ',
    },
    sampleUrls: {
      light: '/audio/ocean_beach.mp3',
      moderate: '/audio/ocean_rocky.mp3',
      strong: '/audio/ocean_rocks.mp3',
    },
  },
  {
    id: 'wind',
    name: 'Ветер',
    icon: 'air',
    defaultVolume: 35,
    intensityLabels: {
      light: 'ТИХИЙ ДЕНЬ',
      moderate: 'ВЕТРЕНЫЙ ДЕНЬ',
      strong: 'ПОРЫВЫ ВЕТРА',
    },
    sampleUrls: {
      light: '/audio/wind_day.mp3',
      moderate: '/audio/wind_day.mp3',
      strong: '/audio/wind_day.mp3',
    },
  },
  {
    id: 'forest',
    name: 'Лес и птицы',
    icon: 'forest',
    defaultVolume: 35,
    intensityLabels: {
      light: 'НОЧНОЙ ЛЕС',
      moderate: 'ЛЕС И ПТИЦЫ',
      strong: 'ЛЕСНОЙ РУЧЕЙ',
    },
    sampleUrls: {
      light: '/audio/forest_night.mp3',
      moderate: '/audio/forest_birds.mp3',
      strong: '/audio/stream_forest.mp3',
    },
  },
  {
    id: 'fireplace',
    name: 'Костер',
    icon: 'local_fire_department',
    defaultVolume: 36,
    intensityLabels: {
      light: 'ТЛЕНИЕ УГЛЕЙ',
      moderate: 'ТРЕСК КОСТРА',
      strong: 'ЯРКОЕ ПЛАМЯ',
    },
    sampleUrls: {
      moderate: '/audio/fire_crackling.mp3',
      strong: '/audio/fire_crackling.mp3',
    },
  },
  {
    id: 'train',
    name: 'Поезд',
    icon: 'directions_transit',
    defaultVolume: 35,
    intensityLabels: {
      light: 'МЯГКИЙ СТУК',
      moderate: 'ИЗ ВАГОНА',
      strong: 'СКОРОСТНОЙ',
    },
    sampleUrls: {
      light: '/audio/train_soft.mp3',
      moderate: '/audio/train_wagon.mp3',
      strong: '/audio/train_wagon.mp3',
    },
  },
];

export interface PresetTrackConfig {
  volume: number;
  intensity: IntensityLevel;
  active: boolean;
}

export interface SoundPreset {
  id: string;
  name: string;
  tracks: Record<string, PresetTrackConfig>;
}

export const SOUND_PRESETS: SoundPreset[] = [
  {
    id: 'calm',
    name: 'Спокойная атмосфера',
    tracks: {
      rain: { active: true, volume: 38, intensity: 'moderate' },
      fireplace: { active: true, volume: 35, intensity: 'moderate' },
      thunder: { active: false, volume: 35, intensity: 'light' },
      ocean: { active: false, volume: 38, intensity: 'light' },
      wind: { active: false, volume: 35, intensity: 'light' },
      forest: { active: false, volume: 35, intensity: 'light' },
      train: { active: false, volume: 35, intensity: 'light' },
    },
  },
  {
    id: 'night_express',
    name: 'Ночной экспресс',
    tracks: {
      train: { active: true, volume: 38, intensity: 'moderate' },
      forest: { active: true, volume: 32, intensity: 'light' },
      rain: { active: true, volume: 30, intensity: 'light' },
      thunder: { active: false, volume: 35, intensity: 'light' },
      ocean: { active: false, volume: 38, intensity: 'light' },
      wind: { active: false, volume: 35, intensity: 'light' },
      fireplace: { active: false, volume: 36, intensity: 'moderate' },
    },
  },
  {
    id: 'thunderstorm',
    name: 'Гроза за окном',
    tracks: {
      rain: { active: true, volume: 42, intensity: 'strong' },
      thunder: { active: true, volume: 38, intensity: 'moderate' },
      wind: { active: true, volume: 35, intensity: 'moderate' },
      forest: { active: false, volume: 35, intensity: 'light' },
      ocean: { active: false, volume: 38, intensity: 'light' },
      fireplace: { active: false, volume: 36, intensity: 'moderate' },
      train: { active: false, volume: 35, intensity: 'light' },
    },
  },
  {
    id: 'forest_stream',
    name: 'Лесной ручей',
    tracks: {
      forest: { active: true, volume: 38, intensity: 'strong' },
      wind: { active: true, volume: 30, intensity: 'light' },
      rain: { active: false, volume: 38, intensity: 'light' },
      thunder: { active: false, volume: 35, intensity: 'light' },
      ocean: { active: false, volume: 38, intensity: 'light' },
      fireplace: { active: false, volume: 36, intensity: 'moderate' },
      train: { active: false, volume: 35, intensity: 'light' },
    },
  },
  {
    id: 'cozy_fireplace',
    name: 'Уют у камина',
    tracks: {
      fireplace: { active: true, volume: 40, intensity: 'moderate' },
      rain: { active: true, volume: 28, intensity: 'light' },
      thunder: { active: false, volume: 35, intensity: 'light' },
      wind: { active: false, volume: 35, intensity: 'light' },
      forest: { active: false, volume: 35, intensity: 'light' },
      ocean: { active: false, volume: 38, intensity: 'light' },
      train: { active: false, volume: 35, intensity: 'light' },
    },
  },
  {
    id: 'ocean_breeze',
    name: 'Морской бриз',
    tracks: {
      ocean: { active: true, volume: 38, intensity: 'light' },
      wind: { active: true, volume: 32, intensity: 'light' },
      rain: { active: false, volume: 38, intensity: 'light' },
      thunder: { active: false, volume: 35, intensity: 'light' },
      forest: { active: false, volume: 35, intensity: 'light' },
      fireplace: { active: false, volume: 36, intensity: 'moderate' },
      train: { active: false, volume: 35, intensity: 'light' },
    },
  },
];
