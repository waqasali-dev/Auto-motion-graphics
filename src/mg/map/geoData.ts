// High-performance vector geographic dataset and projection math for motion graphics.

export interface GeoPoint {
  x: number;
  y: number;
}

export const MAP_WIDTH = 2000;
export const MAP_HEIGHT = 1000;

// Equirectangular / Plate Carrée projection with standard bounds
export function projectGeo(lon: number, lat: number, width = MAP_WIDTH, height = MAP_HEIGHT): GeoPoint {
  // Clamped bounds to avoid infinite distortion at extreme poles
  const clampedLat = Math.max(-75, Math.min(80, lat));
  const clampedLon = Math.max(-180, Math.min(180, lon));

  const x = ((clampedLon + 180) / 360) * width;
  // Latitude goes from +90 at top (y=0) to -90 at bottom (y=height)
  // Scale non-linearly slightly near poles for balanced Miller-like aspect
  const normalizedY = (80 - clampedLat) / 155;
  const y = normalizedY * height;

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
  "sao paulo": [-46.6333, -23.5505],
  "buenos aires": [-58.3816, -34.6037],
  "us": [-98.5795, 39.8283],
  "usa": [-98.5795, 39.8283],
  "united states": [-98.5795, 39.8283],
  "america": [-98.5795, 39.8283],
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
  // Fallback to center
  return { x: MAP_WIDTH / 2, y: MAP_HEIGHT / 2 };
}

// Region bounds presets: { center: [lon, lat], zoom: number }
export const REGION_PRESETS: Record<string, { center: [number, number]; zoom: number }> = {
  world: { center: [10, 20], zoom: 1.0 },
  transatlantic: { center: [-38, 46], zoom: 1.45 },
  transpacific: { center: [-170, 32], zoom: 1.35 },
  northAmerica: { center: [-98, 42], zoom: 1.85 },
  usa: { center: [-98, 39], zoom: 2.2 },
  europe: { center: [12, 52], zoom: 2.4 },
  uk: { center: [-2, 54], zoom: 3.2 },
  asia: { center: [105, 30], zoom: 1.6 },
  eastAsia: { center: [125, 35], zoom: 2.1 },
  middleEast: { center: [48, 27], zoom: 2.3 },
  southAmerica: { center: [-60, -18], zoom: 1.6 },
};

// Simplified, clean continent & major country vector paths projected onto a 2000x1000 canvas.
// These are crafted for sleek, stylized broadcast motion graphics (Vox / Johnny Harris style).
export const WORLD_VECTOR_PATHS: Record<string, string> = {
  // North America
  northAmerica:
    "M 360,110 C 420,100 500,120 540,160 C 580,200 590,260 560,310 C 530,340 480,360 450,420 C 430,460 420,520 400,540 C 370,550 350,510 330,460 C 310,410 260,380 240,330 C 220,280 230,220 270,170 C 300,130 330,120 360,110 Z",
  // Greenland
  greenland:
    "M 740,70 C 780,60 820,80 840,120 C 850,150 830,190 790,210 C 760,220 730,190 710,160 C 700,130 710,90 740,70 Z",
  // United Kingdom & Ireland (distinct path for precise highlighting)
  uk:
    "M 985,215 C 995,205 1010,210 1015,225 C 1020,240 1015,260 1005,275 C 995,285 985,280 980,265 C 975,250 978,225 985,215 Z M 965,240 C 972,235 978,245 975,255 C 972,265 965,265 962,258 C 960,250 962,242 965,240 Z",
  // Continental Europe & Scandinavia
  europe:
    "M 1010,140 C 1050,130 1080,160 1100,210 C 1120,240 1160,250 1180,270 C 1170,300 1140,320 1110,320 C 1080,320 1050,350 1020,350 C 990,350 970,310 990,280 C 1000,260 1000,240 995,210 C 990,170 995,150 1010,140 Z",
  // South America
  southAmerica:
    "M 550,560 C 600,550 660,580 700,640 C 730,690 740,770 710,830 C 680,880 630,940 590,950 C 560,940 540,880 540,820 C 530,760 500,700 500,650 C 500,600 520,570 550,560 Z",
  // Africa
  africa:
    "M 980,380 C 1030,370 1090,390 1130,440 C 1170,490 1200,560 1180,630 C 1160,700 1140,770 1100,820 C 1060,860 1020,850 980,810 C 940,770 910,690 910,620 C 910,550 880,510 890,460 C 900,410 940,390 980,380 Z",
  // Asia & Russia
  asia:
    "M 1200,120 C 1300,110 1450,130 1580,160 C 1680,190 1720,240 1700,310 C 1670,360 1620,400 1560,440 C 1500,480 1420,530 1350,530 C 1280,520 1240,460 1210,410 C 1180,360 1180,280 1190,220 C 1200,170 1180,140 1200,120 Z",
  // Japan (island arc)
  japan:
    "M 1750,300 C 1765,310 1760,340 1745,360 C 1735,370 1725,360 1730,345 C 1735,330 1740,310 1750,300 Z",
  // Australia & New Zealand
  australia:
    "M 1600,680 C 1660,660 1720,680 1750,730 C 1770,780 1760,840 1710,870 C 1660,890 1600,870 1560,830 C 1530,790 1540,730 1570,690 C 1580,680 1590,680 1600,680 Z",
};

// ISO-2 Country to Vector Key / Centroid mapping
export const COUNTRY_ISO_MAP: Record<string, { pathKey: string; center: [number, number]; label: string }> = {
  GB: { pathKey: "uk", center: [-1.17, 52.35], label: "United Kingdom" },
  UK: { pathKey: "uk", center: [-1.17, 52.35], label: "United Kingdom" },
  US: { pathKey: "northAmerica", center: [-98.57, 39.82], label: "United States" },
  USA: { pathKey: "northAmerica", center: [-98.57, 39.82], label: "United States" },
  CA: { pathKey: "northAmerica", center: [-106.34, 56.13], label: "Canada" },
  FR: { pathKey: "europe", center: [2.21, 46.22], label: "France" },
  DE: { pathKey: "europe", center: [10.45, 51.16], label: "Germany" },
  CN: { pathKey: "asia", center: [104.19, 35.86], label: "China" },
  JP: { pathKey: "japan", center: [138.25, 36.2], label: "Japan" },
  RU: { pathKey: "asia", center: [105.31, 61.52], label: "Russia" },
  BR: { pathKey: "southAmerica", center: [-51.92, -14.23], label: "Brazil" },
  AU: { pathKey: "australia", center: [133.77, -25.27], label: "Australia" },
};

