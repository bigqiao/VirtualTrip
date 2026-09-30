export type Person = {
  id: string;
  name: string;
  note: string;
  photoCount: number;
  readyCount: number;
  avatar: string | null;
};
export type Analysis = {
  hasPerson: boolean;
  description: string;
  appearance: string;
  outfit: string;
  style: string[];
  colors: string[];
  seasons: string[];
  temperatureMin: number;
  temperatureMax: number;
  identityQuality: number;
  tags: string[];
  warnings: string[];
};
export type Photo = {
  id: string;
  personId: string;
  personName: string;
  originalName: string;
  subject: string;
  url: string;
  status: string;
  analysis: Analysis | null;
  error: string | null;
};
export type Location = { lat: number; lng: number; name: string };
export type Weather = {
  status: string;
  temperature: number | null;
  apparentTemperature?: number;
  code?: number;
  time?: string;
  timezone?: string;
  source: string;
};
export type EnvironmentPhoto = {
  id: number;
  title: string;
  description: string;
  author: string;
  license: string;
  licenseURL: string | null;
  sourceURL: string;
  url: string;
  date: string;
  width: number;
  height: number;
  distance: number | null;
};
export type Scene = {
  source: "streetview" | "imagined" | "commons";
  photo?: EnvironmentPhoto;
  candidates?: EnvironmentPhoto[];
  manual?: boolean;
  reason?: string;
  date?: string;
  copyright?: string;
  panoId?: string;
};
export type Settings = {
  llm: {
    baseUrl: string;
    model: string;
    imageModel: string;
    configured: boolean;
  };
  google: { configured: boolean };
  environment?: { provider: "commons" | "google" };
};
export type Outfit = { photoId?: string; instruction?: string };
export type PhotographyStyle = "daily" | "film" | "editorial" | "drone";
export type TravelRequest = {
  environmentPhotoId?: number;
  location: Location;
  personIds: string[];
  outfits: Record<string, Outfit>;
  temperature: number | null;
  heading: number;
  style: PhotographyStyle;
  moment: string;
  aspect: string;
  instruction: string;
};
export type Selection = {
  personId: string;
  name: string;
  url: string;
  photoId: string;
  reason: string;
  adapt: boolean;
  manual: boolean;
  selectionMethod?: "manual" | "adapt" | "rules" | "llm" | "fallback";
  outfit: string;
  appearance: string;
  instruction: string;
  references?: {
    photoId: string;
    url: string;
    role: "identity" | "identity-outfit";
  }[];
};
export type Plan = {
  previewToken?: string;
  photography?: { style: PhotographyStyle; label: string; summary: string };
  temperature: number | null;
  temperatureSource: string;
  weather: Weather;
  scene: Scene;
  selected: Selection[];
  narrative?: {
    title: string;
    sceneDescription: string;
    photography: string;
    peopleActions?: { personId: string; action: string }[];
  };
};
export type Trip = {
  id: string;
  title: string;
  status: string;
  stage: string;
  request: TravelRequest;
  plan: Plan | null;
  url: string | null;
  error: string | null;
  favorite: boolean;
  createdAt: string;
};
export type State = {
  people: Person[];
  photos: Photo[];
  trips: Trip[];
  settings: Settings;
};
