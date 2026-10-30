// High-performance vector geographic dataset and projection math for motion graphics.
import { NATURAL_EARTH_LAND_PATH, NATURAL_EARTH_COUNTRY_PATHS } from "./naturalEarthData";

export interface GeoPoint {
  x: number;
  y: number;
}

export const MAP_WIDTH = 2000;
export const MAP_HEIGHT = 1000;

// Standard Equirectangular / Plate Carrée projection matching Natural Earth 110m
export function projectGeo(lon: number, lat: number, width = MAP_WIDTH, height = MAP_HEIGHT): GeoPoint {
  const clampedLat = Math.max(-85, Math.min(85, lat));
  const clampedLon = Math.max(-180, Math.min(180, lon));

  const x = ((clampedLon + 180) / 360) * width;
  const y = ((90 - clampedLat) / 180) * height;

  return { x, y };
}

// Major global hubs & sovereign centers (longitude, latitude)
export const GEO_LOCATIONS: Record<string, [number, number]> = {
  // Americas
  "new york": [-74.006, 40.7128],
  "nyc": [-74.006, 40.7128],
  "washington": [-77.0369, 38.9072],
  "dc": [-77.0369, 38.9072],
  "san francisco": [-122.4194, 37.7749],
  "silicon valley": [-122.0839, 37.3861],
  "los angeles": [-118.2437, 34.0522],
  "chicago": [-87.6298, 41.8781],
  "seattle": [-122.3321, 47.6062],
  "austin": [-97.7431, 30.2672],
  "miami": [-80.1918, 25.7617],
  "toronto": [-79.3832, 43.6532],
  "vancouver": [-123.1207, 49.2827],
  "mexico city": [-99.1332, 19.4326],
  "lima": [-77.0428, -12.0464],
  "sao paulo": [-46.6333, -23.5505],
  "buenos aires": [-58.3816, -34.6037],
  "us": [-98.5795, 39.8283],
  "usa": [-98.5795, 39.8283],
  "united states": [-98.5795, 39.8283],
  "america": [-98.5795, 39.8283],
  "southern us": [-90.0, 31.0],
  "southern united states": [-90.0, 31.0],
  "north america": [-98.0, 45.0],
  "south america": [-60.0, -18.0],
  "canada": [-106.3468, 56.1304],
  "brazil": [-51.9253, -14.235],

  // Europe & UK
  "london": [-0.1276, 51.5072],
  "uk": [-1.1743, 52.3555],
  "britain": [-1.1743, 52.3555],
  "united kingdom": [-1.1743, 52.3555],
  "england": [-1.1743, 52.3555],
  "paris": [2.3522, 48.8566],
  "france": [2.2137, 46.2276],
  "berlin": [13.405, 52.52],
  "frankfurt": [8.6821, 50.1109],
  "germany": [10.4515, 51.1657],
  "amsterdam": [4.9041, 52.3676],
  "netherlands": [5.2913, 52.1326],
  "dublin": [-6.2603, 53.3498],
  "ireland": [-8.2439, 53.4129],
  "brussels": [4.3517, 50.8503],
  "belgium": [4.4699, 50.5039],
  "geneva": [6.1432, 46.2044],
  "zurich": [8.5417, 47.3769],
  "switzerland": [8.2275, 46.8182],
  "rome": [12.4964, 41.9028],
  "milan": [9.19, 45.4642],
  "italy": [12.5674, 41.8719],
  "madrid": [-3.7038, 40.4168],
  "spain": [-3.7492, 40.4637],
  "stockholm": [18.0686, 59.3293],
  "sweden": [18.6435, 60.1282],
  "moscow": [37.6173, 55.7558],
  "russia": [105.3188, 61.524],
  "kyiv": [30.5234, 50.4501],
  "ukraine": [31.1656, 48.3794],
  "europe": [15.2551, 50.526],
  "eu": [15.2551, 50.526],

  // Middle East & Africa
  "dubai": [55.2708, 25.2048],
  "uae": [53.8478, 23.4241],
  "abu dhabi": [54.3773, 24.4539],
  "riyadh": [46.7139, 24.7136],
  "saudi arabia": [45.0792, 23.8859],
  "tel aviv": [34.7818, 32.0853],
  "israel": [34.8516, 31.0461],
  "doha": [51.531, 25.2854],
  "qatar": [51.1839, 25.3548],
  "cairo": [31.2357, 30.0444],
  "egypt": [30.8025, 26.8206],
  "johannesburg": [28.0473, -26.2041],
  "cape town": [18.4241, -33.9249],
  "south africa": [22.9375, -30.5595],
  "lagos": [3.3792, 6.5244],
  "nigeria": [8.6753, 9.082],

  // Asia & Oceania
  "tokyo": [139.6917, 35.6895],
  "japan": [138.2529, 36.2048],
  "beijing": [116.4074, 39.9042],
  "shanghai": [121.4737, 31.2304],
  "shenzhen": [114.0579, 22.5431],
  "hong kong": [114.1694, 22.3193],
  "china": [104.1954, 35.8617],
  "seoul": [126.978, 37.5665],
  "south korea": [127.7669, 35.9078],
  "korea": [127.7669, 35.9078],
  "taipei": [121.5654, 25.033],
  "taiwan": [120.9605, 23.6978],
  "singapore": [103.8198, 1.3521],
  "mumbai": [72.8777, 19.076],
  "delhi": [77.1025, 28.7041],
  "bangalore": [77.5946, 12.9716],
  "india": [78.9629, 20.5937],
  "jakarta": [106.8456, -6.2088],
  "indonesia": [113.9213, -0.7893],
  "darwin": [130.8456, -12.4634],
  "sydney": [151.2093, -33.8688],
  "melbourne": [144.9631, -37.8136],
  "australia": [133.7751, -25.2744],
};

export function resolveLocation(target: string | [number, number]): GeoPoint {
  if (Array.isArray(target) && target.length >= 2) {
    return projectGeo(target[0], target[1]);
  }
  if (typeof target === "string") {
    const key = target.toLowerCase().trim();
    if (GEO_LOCATIONS[key]) {
      const [lon, lat] = GEO_LOCATIONS[key];
      return projectGeo(lon, lat);
    }
  }
  return { x: MAP_WIDTH / 2, y: MAP_HEIGHT / 2 };
}

// Country & region alias mapping to SVG path keys
export const COUNTRY_ALIASES: Record<string, string> = {
  "canada": "Canada",
  "ca": "CA",
  "united states": "United States",
  "usa": "USA",
  "us": "US",
  "america": "America",
  "southern united states": "US",
  "southern us": "US",
  "north america": "North America",
  "na": "NA",
  "south america": "South America",
  "sa": "SA",
  "brazil": "BR",
  "argentina": "AR",
  "peru": "PE",
  "chile": "CL",
  "colombia": "CO",
  "united kingdom": "UK",
  "uk": "UK",
  "britain": "Britain",
  "england": "England",
  "france": "France",
  "germany": "Germany",
  "europe": "Europe",
  "eu": "EU",
  "russia": "Russia",
  "china": "China",
  "japan": "Japan",
  "india": "India",
  "indonesia": "Indonesia",
  "australia": "Australia",
};

export function resolveCountryPath(input: string): string | null {
  if (!input) return null;
  const key = String(input).trim();
  const lower = key.toLowerCase();
  const alias = COUNTRY_ALIASES[lower] || key.toUpperCase();
  return NATURAL_EARTH_COUNTRY_PATHS[alias] || NATURAL_EARTH_COUNTRY_PATHS[key] || null;
}

// Region presets with exact cartographic centering & zoom
export const REGION_PRESETS: Record<string, { center: [number, number]; zoom: number }> = {
  world: { center: [0, 20], zoom: 1.0 },
  transatlantic: { center: [-35, 45], zoom: 1.6 },
  transpacific: { center: [180, 15], zoom: 1.4 },
  pacific: { center: [160, 0], zoom: 1.45 },
  northAmerica: { center: [-98, 42], zoom: 1.85 },
  southAmerica: { center: [-60, -18], zoom: 2.0 },
  usa: { center: [-98, 39], zoom: 2.2 },
  canada: { center: [-106, 56], zoom: 2.2 },
  europe: { center: [12, 52], zoom: 2.6 },
  uk: { center: [-2, 54], zoom: 3.5 },
  asia: { center: [105, 30], zoom: 1.6 },
  eastAsia: { center: [125, 35], zoom: 2.2 },
  middleEast: { center: [48, 27], zoom: 2.3 },
};

// Export authentic Natural Earth paths
export const WORLD_LAND_PATH = NATURAL_EARTH_LAND_PATH;
export const WORLD_COUNTRY_PATHS = NATURAL_EARTH_COUNTRY_PATHS;
