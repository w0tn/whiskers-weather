'use strict';

(function () {

// ============================================================
// CONFIGURATION
// ============================================================
const CONFIG = {
    WEATHER_API: 'https://api.open-meteo.com/v1/forecast',
    GEOCODE_API: 'https://geocoding-api.open-meteo.com/v1/search',
    REVERSE_GEOCODE_API: 'https://api.bigdatacloud.net/data/reverse-geocode-client',
    REFRESH_INTERVAL: 600000,
    HOURLY_HOURS: 24
};

const WMO_CODES = {
    0:  { cond: 'clear',         label: 'Clear Skies' },
    1:  { cond: 'clear',         label: 'Mainly Clear' },
    2:  { cond: 'partly-cloudy', label: 'Partly Cloudy' },
    3:  { cond: 'overcast',      label: 'Overcast' },
    45: { cond: 'fog',           label: 'Foggy' },
    48: { cond: 'fog',           label: 'Rime Fog' },
    51: { cond: 'drizzle',       label: 'Light Drizzle' },
    53: { cond: 'drizzle',       label: 'Drizzle' },
    55: { cond: 'drizzle',       label: 'Dense Drizzle' },
    56: { cond: 'drizzle',       label: 'Freezing Drizzle' },
    57: { cond: 'drizzle',       label: 'Freezing Drizzle' },
    61: { cond: 'rain',          label: 'Light Rain' },
    63: { cond: 'rain',          label: 'Rain' },
    65: { cond: 'heavy-rain',    label: 'Heavy Rain' },
    66: { cond: 'rain',          label: 'Freezing Rain' },
    67: { cond: 'heavy-rain',    label: 'Freezing Rain' },
    71: { cond: 'snow',          label: 'Light Snow' },
    73: { cond: 'snow',          label: 'Snow' },
    75: { cond: 'heavy-snow',     label: 'Heavy Snow' },
    77: { cond: 'snow',          label: 'Snow Grains' },
    80: { cond: 'rain',          label: 'Rain Showers' },
    81: { cond: 'heavy-rain',    label: 'Rain Showers' },
    82: { cond: 'heavy-rain',    label: 'Violent Showers' },
    85: { cond: 'snow',          label: 'Snow Showers' },
    86: { cond: 'heavy-snow',     label: 'Heavy Snow Showers' },
    95: { cond: 'thunderstorm',  label: 'Thunderstorm' },
    96: { cond: 'thunderstorm',  label: 'Thunderstorm' },
    99: { cond: 'thunderstorm',  label: 'Severe Thunderstorm' }
};

const SCENE_CFG = {
    'clear':         { pose: 'sit',     particles: null,          lightning: false, clouds: 0 },
    'partly-cloudy': { pose: 'sit',     particles: null,          lightning: false, clouds: 3 },
    'overcast':      { pose: 'sit',     particles: null,          lightning: false, clouds: 6 },
    'fog':           { pose: 'forward', particles: 'fog',         lightning: false, clouds: 0 },
    'drizzle':       { pose: 'shelter', particles: 'rain-light',  lightning: false, clouds: 4 },
    'rain':          { pose: 'shelter', particles: 'rain',        lightning: false, clouds: 5 },
    'heavy-rain':    { pose: 'shelter', particles: 'rain-heavy',  lightning: false, clouds: 6 },
    'snow':          { pose: 'curl',    particles: 'snow',        lightning: false, clouds: 4 },
    'heavy-snow':    { pose: 'curl',    particles: 'snow-heavy',  lightning: false, clouds: 6 },
    'thunderstorm':  { pose: 'watch',   particles: 'rain-heavy',  lightning: true,  clouds: 6 }
};

// ============================================================
// STATE
// ============================================================
const AppState = {
    lat: null,
    lon: null,
    units: localStorage.getItem('wotn_units') || 'metric',
    theme: localStorage.getItem('wotn_theme') || 'auto',
    forceReducedMotion: localStorage.getItem('wotn_force_reduced') === 'true',
    reducedMotion: false,
    currentWeather: null,
    hourly: null,
    daily: null,
    utcOffset: 0,
    lastUpdated: null,
    isCached: false,
    refreshTimer: null,
    animFrame: null
};

// ============================================================
// DOM
// ============================================================
const els = {};
function cacheDOM() {
    const ids = [
        'btn-location','btn-settings','location-display','scene-root','sky-gradient',
        'environment-layer','whiskers-svg','horizon-overlay','dashboard-panel',
        'curr-temp','condition-text','high-low','feel-temp',
        'moon-widget','moon-gauge','moon-phase-name','moon-rise-set',
        'humidity','wind-speed','precip-prob','uv-index',
        'toggle-forecast','forecast-drawer','hourly-list','daily-list',
        'settings-modal','settings-form','setting-unit','setting-theme',
        'setting-motion-auto','setting-motion-force','manual-search-trigger',
        'search-modal','search-form','city-input','search-results',
        'alert-banner','alert-title','alert-msg'
    ];
    ids.forEach(id => { els[id] = document.getElementById(id); });
}

// ============================================================
// INIT
// ============================================================
function init() {
    cacheDOM();
    checkReducedMotion();
    setupEventListeners();

    // Restore saved location
    const savedLat = parseFloat(localStorage.getItem('wotn_lat'));
    const savedLon = parseFloat(localStorage.getItem('wotn_lon'));
    if (savedLat && savedLon) {
        setLocation(savedLat, savedLon, localStorage.getItem('wotn_loc_name') || '');
    }

    // Try geolocation
    if ('geolocation' in navigator) {
        navigator.geolocation.getCurrentPosition(
            pos => setLocation(pos.coords.latitude, pos.coords.longitude, ''),
            err => {
                if (!savedLat) {
                    showStatus('Location needed. Tap settings to enter a city manually.');
                    setTimeout(() => { if (els.btnSettings) els.btnSettings.click(); }, 1500);
                }
            },
            { timeout: 10000, enableHighAccuracy: false }
        );
    } else if (!savedLat) {
        showStatus('Geolocation not supported. Enter a city manually in settings.');
        setTimeout(() => { if (els.btnSettings) els.btnSettings.click(); }, 1500);
    }

    // Load cached weather immediately if available
    loadCachedWeather();

    // Visibility handling
    document.addEventListener('visibilitychange', onVisibilityChange);

    registerSW();
}

// ============================================================
// EVENT LISTENERS
// ============================================================
function setupEventListeners() {
    if (els.btnLocation) {
        els.btnLocation.addEventListener('click', () => {
            if (navigator.geolocation) {
                showStatus('Locating...');
                navigator.geolocation.getCurrentPosition(
                    pos => setLocation(pos.coords.latitude, pos.coords.longitude, ''),
                    err => showError('Could not get location. Try entering a city manually.'),
                    { timeout: 10000 }
                );
            }
        });
    }

    if (els.toggleForecast) {
        els.toggleForecast.addEventListener('click', () => {
            if (els.forecastDrawer) {
                els.forecastDrawer.classList.toggle('hidden');
                els.toggleForecast.textContent = els.forecastDrawer.classList.contains('hidden')
                    ? 'View Forecast' : 'Close Forecast';
            }
        });
    }

    if (els.btnSettings) {
        els.btnSettings.addEventListener('click', () => {
            loadSettingsIntoForm();
            if (els.settingsModal) els.settingsModal.showModal();
        });
    }

    if (els.settingsForm) {
        els.settingsForm.addEventListener('close', saveSettingsFromForm);
    }

    if (els.manualSearchTrigger) {
        els.manualSearchTrigger.addEventListener('click', () => {
            if (els.settingsModal) els.settingsModal.close();
            setTimeout(() => { if (els.searchModal) els.searchModal.showModal(); }, 100);
        });
    }

    if (els.searchForm) {
        els.searchForm.addEventListener('submit', e => {
            e.preventDefault();
            const q = els.cityInput ? els.cityInput.value.trim() : '';
            if (q) searchLocation(q);
        });
    }

    // Reduced motion media query
    window.matchMedia('(prefers-reduced-motion: reduce)').addEventListener('change', checkReducedMotion);

    // Unit/theme live update
    if (els.settingUnit) {
        els.settingUnit.addEventListener('change', () => {
            if (AppState.currentWeather) {
                AppState.units = els.settingUnit.value;
                localStorage.setItem('wotn_units', AppState.units);
                fetchWeather();
            }
        });
    }
}

// ============================================================
// LOCATION
// ============================================================
function setLocation(lat, lon, name) {
    AppState.lat = lat;
    AppState.lon = lon;
    localStorage.setItem('wotn_lat', lat);
    localStorage.setItem('wotn_lon', lon);
    if (name) {
        AppState.locationName = name;
        localStorage.setItem('wotn_loc_name', name);
        if (els.locDisplay) els.locDisplay.textContent = name;
    }
    fetchWeather();
}

async function searchLocation(query) {
    const url = `${CONFIG.GEOCODE_API}?name=${encodeURIComponent(query)}&count=5&language=en&format=json`;
    try {
        const res = await fetch(url);
        if (!res.ok) throw new Error('Geocoding failed');
        const data = await res.json();
        if (!data.results || data.results.length === 0) {
            if (els.searchResults) {
                els.searchResults.innerHTML = '<li>No locations found. Try "City, Country"</li>';
            }
            return;
        }
        if (els.searchResults) {
            els.searchResults.innerHTML = '';
            data.results.forEach(r => {
                const li = document.createElement('li');
                li.style.cssText = 'cursor:pointer;padding:8px;border-bottom:1px solid #333;list-style:none;';
                li.textContent = `${r.name}${r.admin1 ? ', ' + r.admin1 : ''}, ${r.country || ''}`;
                li.addEventListener('click', () => {
                    setLocation(r.latitude, r.longitude, li.textContent);
                    if (els.searchModal) els.searchModal.close();
                });
                els.searchResults.appendChild(li);
            });
        }
    } catch (err) {
        if (els.searchResults) {
            els.searchResults.innerHTML = '<li>Search failed. Check connection.</li>';
        }
    }
}

async function reverseGeocode(lat, lon) {
    try {
        const url = `${CONFIG.REVERSE_GEOCODE_API}?latitude=${lat}&longitude=${lon}&localityLanguage=en`;
        const res = await fetch(url);
        if (!res.ok) return '';
        const data = await res.json();
        const parts = [];
        if (data.city) parts.push(data.city);
        else if (data.locality) parts.push(data.locality);
        else if (data.principalSubdivision) parts.push(data.principalSubdivision);
        if (data.countryName) parts.push(data.countryName);
        return parts.join(', ');
    } catch { return ''; }
}

// ============================================================
// WEATHER API
// ============================================================
async function fetchWeather() {
    if (!AppState.lat || !AppState.lon) return;

    const tempUnit = AppState.units === 'metric' ? 'celsius' : 'fahrenheit';
    const windUnit = AppState.units === 'metric' ? 'kmh' : 'mph';

    const params = new URLSearchParams({
        latitude: AppState.lat,
        longitude: AppState.lon,
        current_weather: 'true',
        hourly: 'temperature_2m,relativehumidity_2m,apparent_temperature,dewpoint_2m,precipitation_probability,precipitation,rain,snowfall,weathercode,windspeed_10m,winddirection_10m,windgusts_10m,surface_pressure,visibility,uv_index,cloudcover',
        daily: 'weathercode,temperature_2m_max,temperature_2m_min,sunrise,sunset,uv_index_max,precipitation_probability_max',
        timezone: 'auto',
        wind_speed_unit: windUnit,
        temperature_unit: tempUnit
    });

    const url = `${CONFIG.WEATHER_API}?${params.toString()}`;

    try {
        showStatus('Reading the sky...');
        const res = await fetch(url);
        if (!res.ok) throw new Error('Weather service unavailable');
        const data = await res.json();

        AppState.utcOffset = data.utc_offset_seconds || 0;
        cacheWeatherData(data);
        processWeather(data);

        // Reverse geocode for nice name
        if (!AppState.locationName) {
            const name = await reverseGeocode(AppState.lat, AppState.lon);
            if (name) {
                AppState.locationName = name;
                localStorage.setItem('wotn_loc_name', name);
                if (els.locDisplay) els.locDisplay.textContent = name;
            }
        }

        // Schedule next refresh
        if (AppState.refreshTimer) clearTimeout(AppState.refreshTimer);
        AppState.refreshTimer = setTimeout(fetchWeather, CONFIG.REFRESH_INTERVAL);
    } catch (err) {
        console.error('Weather fetch error:', err);
        if (!loadCachedWeather()) {
            showError('Could not reach weather service. Check your connection.');
        }
    }
}

function processWeather(data) {
    if (!data || !data.current_weather) return;

    AppState.currentWeather = data.current_weather;
    AppState.hourly = data.hourly || null;
    AppState.daily = data.daily || null;
    AppState.lastUpdated = new Date();
    AppState.isCached = false;

    updateCurrentWeather(data);
    if (AppState.hourly) renderHourlyForecast(AppState.hourly);
    if (AppState.daily) renderDailyForecast(AppState.daily);
    renderMoonWidget(new Date());
    renderScene(data.current_weather);

    // Update location display
    if (AppState.locationName && els.locDisplay) {
        els.locDisplay.textContent = AppState.locationName;
    } else if (els.locDisplay) {
        els.locDisplay.textContent = 'Local Area';
    }

    clearError();
}

// ============================================================
// WEATHER CODE INTERPRETATION
// ============================================================
function interpretCode(code) {
    const entry = WMO_CODES[code];
    if (entry) return entry;
    return { cond: 'clear', label: 'Unknown' };
}

function getCurrentHourIndex() {
    if (!AppState.hourly || !AppState.currentWeather) return 0;
    const cwTime = AppState.currentWeather.time;
    const hourStr = cwTime.substring(0, 13); // "2024-01-15T14"
    const idx = AppState.hourly.time.findIndex(t => t.startsWith(hourStr));
    return idx >= 0 ? idx : 0;
}

// ============================================================
// UNIT HELPERS
// ============================================================
function tempSuffix() { return AppState.units === 'metric' ? '°C' : '°F'; }
function speedLabel() { return AppState.units === 'metric' ? 'km/h' : 'mph'; }

function degToCompass(deg) {
    const dirs = ['N','NNE','NE','ENE','E','ESE','SE','SSE','S','SSW','SW','WSW','W','WNW','NW','NNW'];
    return dirs[Math.round(deg / 22.5) % 16];
}

// ============================================================
// MOON CALCULATIONS
// ============================================================
function calculateMoon(date) {
    const year = date.getFullYear();
    const month = date.getMonth() + 1;
    const day = date.getDate();

    let jd = 367 * year
        - Math.floor(7 * (year + Math.floor((month + 9) / 12)) / 4)
        + Math.floor(275 * month / 9)
        + day + 1721013.5;

    const knownNew = 2451550.1;
    const synodic = 29.53058867;

    let daysSince = (jd - knownNew) % synodic;
    if (daysSince < 0) daysSince += synodic;

    const phase = daysSince / synodic;
    const illumination = (1 - Math.cos(2 * Math.PI * phase)) / 2;
    const age = daysSince;

    let phaseName, isWaxing;
    if (phase < 0.03 || phase > 0.97) { phaseName = 'New Moon'; isWaxing = phase < 0.5; }
    else if (phase < 0.22) { phaseName = 'Waxing Crescent'; isWaxing = true; }
    else if (phase < 0.28) { phaseName = 'First Quarter'; isWaxing = true; }
    else if (phase < 0.47) { phaseName = 'Waxing Gibbous'; isWaxing = true; }
    else if (phase < 0.53) { phaseName = 'Full Moon'; isWaxing = false; }
    else if (phase < 0.72) { phaseName = 'Waning Gibbous'; isWaxing = false; }
    else if (phase < 0.78) { phaseName = 'Last Quarter'; isWaxing = false; }
    else { phaseName = 'Waning Crescent'; isWaxing = false; }

    const daysToFull = ((0.5 - phase + 1) % 1) * synodic;
    const daysToNew = ((1 - phase) % 1) * synodic;
    const nextFull = new Date(date.getTime() + daysToFull * 86400000);
    const nextNew = new Date(date.getTime() + daysToNew * 86400000);

    return { phase, illumination, age, phaseName, isWaxing, nextFull, nextNew };
}

function approxMoonTimes(phaseVal, date) {
    const baseRise = 6 + phaseVal * 24;
    const moonriseHour = baseRise % 24;
    const moonsetHour = (moonriseHour + 12) % 24;

    const rise = new Date(date);
    rise.setHours(Math.floor(moonriseHour), Math.round((moonriseHour % 1) * 60), 0, 0);

    const set = new Date(date);
    set.setHours(Math.floor(moonsetHour), Math.round((moonsetHour % 1) * 60), 0, 0);

    return { rise, set };
}

// ============================================================
// SCENE RENDERING
// ============================================================
function renderScene(curr) {
    if (!curr) return;

    const code = parseInt(curr.weathercode);
    const wmo = interpretCode(code);
    const sceneCfg = SCENE_CFG[wmo.cond] || SCENE_CFG['clear'];

    // Determine day/night
    const now = new Date();
    let isDay = curr.is_day === 1;

    // Check sunrise/sunset if available
    if (AppState.daily && AppState.daily.sunrise && AppState.daily.sunset) {
        const sunrise = new Date(AppState.daily.sunrise[0]);
        const sunset = new Date(AppState.daily.sunset[0]);
        isDay = now >= sunrise && now < sunset;
    }

    // Theme override
    if (AppState.theme === 'night') isDay = false;

    // Clear environment layer
    if (els.envLayer) els.envLayer.innerHTML = '';

    // Set sky gradient
    const scene = els.sceneRoot;
    if (scene) {
        let bg;
        if (isDay) {
            if (wmo.cond === 'overcast') bg = 'linear-gradient(to bottom, #4a5568, #6b7280, #9ca3af)';
            else if (wmo.cond === 'fog') bg = 'linear-gradient(to bottom, #6b7280, #9ca3af, #d1d5db)';
            else if (wmo.cond === 'rain' || wmo.cond === 'heavy-rain' || wmo.cond === 'drizzle') bg = 'linear-gradient(to bottom, #475569, #64748b, #94a3b8)';
            else if (wmo.cond === 'snow' || wmo.cond === 'heavy-snow') bg = 'linear-gradient(to bottom, #6b7280, #9ca3af, #e5e7eb)';
            else if (wmo.cond === 'thunderstorm') bg = 'linear-gradient(to bottom, #1e1b2e, #373050, #4c3a6b)';
            else bg = 'linear-gradient(to bottom, #5b7a9a, #8ab4d4, #c5dae8)';
        } else {
            if (wmo.cond === 'overcast') bg = 'linear-gradient(to bottom, #0f1219, #1a1d2e, #232838)';
            else if (wmo.cond === 'fog') bg = 'linear-gradient(to bottom, #1a1d2e, #2a2d3e, #3a3d4e)';
            else if (wmo.cond === 'rain' || wmo.cond === 'heavy-rain' || wmo.cond === 'drizzle') bg = 'linear-gradient(to bottom, #0a0e17, #141826, #1e2235)';
            else if (wmo.cond === 'snow' || wmo.cond === 'heavy-snow') bg = 'linear-gradient(to bottom, #0d1117, #1a2030, #2a3040)';
            else if (wmo.cond === 'thunderstorm') bg = 'linear-gradient(to bottom, #0a0a14, #161228, #1f1535)';
            else bg = 'linear-gradient(to bottom, #080b14, #0f1528, #1a1f3a)';
        }
        scene.style.background = bg;
        scene.style.transition = 'background 2s ease';
        document.body.style.backgroundColor = isDay ? '#94a3b8' : '#000000';
    }

    // Stars (clear or partly cloudy night)
    if (!isDay && (wmo.cond === 'clear' || wmo.cond === 'partly-cloudy')) {
        createStars(35);
    }

    // Moon (nighttime, not overcast)
    if (!isDay && wmo.cond !== 'overcast' && wmo.cond !== 'fog') {
        const moon = calculateMoon(now);
        createMoonInScene(moon);
    }

    // Clouds
    if (sceneCfg.clouds > 0) {
        createClouds(sceneCfg.clouds, isDay);
    }

    // Particles
    if (sceneCfg.particles && !AppState.reducedMotion) {
        const windSpeed = curr.windspeed || 10;
        const windAngle = curr.winddirection || 0;
        switch (sceneCfg.particles) {
            case 'fog':         createFog(); break;
            case 'rain-light':  createRain(40, windSpeed, windAngle); break;
            case 'rain':        createRain(80, windSpeed, windAngle); break;
            case 'rain-heavy':  createRain(140, windSpeed, windAngle); break;
            case 'snow':        createSnow(40); break;
            case 'snow-heavy':  createSnow(80); break;
        }
    }

    // Lightning
    if (sceneCfg.lightning && !AppState.reducedMotion) {
        createLightning();
    }

    // Wind effect on Whiskers
    if (curr.windspeed > 25) {
        setWhiskersPose('wind');
    } else {
        setWhiskersPose(sceneCfg.pose);
    }

    // Extreme temperature adjustments
    const temp = curr.temperature;
    if (AppState.units === 'metric') {
        if (temp > 38) setWhiskersPose('rest');
        if (temp < -10) setWhiskersPose('curl');
    } else {
        if (temp > 100) setWhiskersPose('rest');
        if (temp < 14) setWhiskersPose('curl');
    }
}

function createStars(count) {
    if (!els.envLayer) return;
    const frag = document.createDocumentFragment();
    for (let i = 0; i < count; i++) {
        const s = document.createElement('div');
        s.style.cssText = `position:absolute;width:2px;height:2px;background:#fff;border-radius:50%;left:${Math.random()*100}%;top:${Math.random()*55}%;opacity:${0.3+Math.random()*0.7};animation:twinkle ${2+Math.random()*3}s ease-in-out infinite;animation-delay:${Math.random()*3}s;`;
        frag.appendChild(s);
    }
    els.envLayer.appendChild(frag);
}

function createMoonInScene(moon) {
    if (!els.envLayer) return;
    const moonEl = document.createElement('div');
    moonEl.style.cssText = 'position:absolute;right:15%;top:12%;width:65px;height:65px;';

    const radius = 30;
    const offset = moon.illumination * 2 * radius;
    const shadowX = 50 + (moon.isWaxing ? -offset : offset);

    moonEl.innerHTML = `<svg viewBox="0 0 100 100" style="width:100%;height:100%;">
        <defs>
            <filter id="moonGlow"><feGaussianBlur stdDeviation="3" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
        </defs>
        <circle cx="50" cy="50" r="${radius}" fill="#e8e0c0" filter="url(#moonGlow)"/>
        <circle cx="${shadowX}" cy="50" r="${radius}" fill="#0a0e17"/>
    </svg>`;

    els.envLayer.appendChild(moonEl);
}

function createClouds(density, isDay) {
    if (!els.envLayer) return;
    const cloudColor = isDay ? 'rgba(255,255,255,0.7)' : 'rgba(60,65,80,0.6)';
    for (let i = 0; i < density; i++) {
        const c = document.createElement('div');
        const w = 120 + Math.random() * 180;
        const h = 40 + Math.random() * 30;
        const top = 5 + Math.random() * 35;
        const dur = 60 + Math.random() * 80;
        c.style.cssText = `position:absolute;width:${w}px;height:${h}px;background:${cloudColor};border-radius:50%;left:-${w}px;top:${top}%;filter:blur(${8+Math.random()*12}px);opacity:${0.5+Math.random()*0.3};animation:drift ${dur}s linear infinite;animation-delay:${-Math.random()*dur}s;`;
        els.envLayer.appendChild(c);
    }
}

function createRain(count, windSpeed, windDir) {
    if (!els.envLayer) return;
    const frag = document.createDocumentFragment();
    const angle = Math.min(Math.abs(windSpeed) * 0.3, 25);
    const direction = (windDir > 180) ? -angle : angle;
    for (let i = 0; i < count; i++) {
        const r = document.createElement('div');
        const dur = 0.4 + Math.random() * 0.6;
        r.style.cssText = `position:absolute;width:1.5px;height:${8+Math.random()*8}px;background:rgba(170,190,220,0.5);left:${Math.random()*100}%;top:-20px;transform:rotate(${direction}deg);animation:fall ${dur}s linear infinite;animation-delay:${Math.random()*2}s;`;
        frag.appendChild(r);
    }
    els.envLayer.appendChild(frag);
}

function createSnow(count) {
    if (!els.envLayer) return;
    const frag = document.createDocumentFragment();
    for (let i = 0; i < count; i++) {
        const s = document.createElement('div');
        const size = 3 + Math.random() * 5;
        const dur = 4 + Math.random() * 6;
        s.style.cssText = `position:absolute;width:${size}px;height:${size}px;background:rgba(255,255,255,0.8);border-radius:50%;left:${Math.random()*100}%;top:-10px;animation:snowFall ${dur}s linear infinite;animation-delay:${Math.random()*5}s;`;
        frag.appendChild(s);
    }
    els.envLayer.appendChild(frag);
}

function createFog() {
    if (!els.envLayer) return;
    for (let i = 0; i < 4; i++) {
        const f = document.createElement('div');
        f.style.cssText = `position:absolute;width:200%;height:30%;background:rgba(180,185,200,${0.08+i*0.04});left:-50%;top:${20+i*15}%;filter:blur(20px);animation:drift ${120+i*30}s linear infinite;`;
        els.envLayer.appendChild(f);
    }
}

function createLightning() {
    if (!els.envLayer) return;
    const flash = document.createElement('div');
    flash.style.cssText = 'position:absolute;inset:0;background:white;opacity:0;pointer-events:none;z-index:5;';
    flash.id = 'lightning-flash';
    els.envLayer.appendChild(flash);

    function triggerFlash() {
        if (AppState.reducedMotion || !document.getElementById('lightning-flash')) return;
        const el = document.getElementById('lightning-flash');
        el.style.transition = 'opacity 0.08s';
        el.style.opacity = '0.15';
        setTimeout(() => {
            el.style.opacity = '0';
            setTimeout(() => { el.style.opacity = '0.08'; }, 80);
            setTimeout(() => { el.style.opacity = '0'; }, 160);
        }, 80);
        setTimeout(triggerFlash, 5000 + Math.random() * 15000);
    }
    setTimeout(triggerFlash, 3000 + Math.random() * 5000);
}

function setWhiskersPose(pose) {
    const svg = els.whiskersSvg;
    if (!svg) return;
    const body = svg.querySelector('#cat-body');
    if (!body) return;

    svg.classList.remove('pose-sit','pose-curl','pose-shelter','pose-watch','pose-forward','pose-wind','pose-rest');
    svg.classList.add(`pose-${pose}`);

    switch (pose) {
        case 'curl':
            body.setAttribute('transform', 'translate(0,5) scale(0.92)');
            break;
        case 'shelter':
            body.setAttribute('transform', 'translate(8,3) scale(0.96)');
            break;
        case 'watch':
            body.setAttribute('transform', 'translate(0,-2) scale(1.02)');
            break;
        case 'forward':
            body.setAttribute('transform', 'translate(-5,0) scale(1.0)');
            break;
        case 'wind':
            body.setAttribute('transform', 'translate(2,-1) rotate(-2)');
            break;
        case 'rest':
            body.setAttribute('transform', 'translate(0,8) scale(0.95)');
            break;
        default:
            body.setAttribute('transform', '');
    }
}

// ============================================================
// UI RENDERING
// ============================================================
function updateCurrentWeather(data) {
    const cw = data.current_weather;
    if (!cw) return;
    const wmo = interpretCode(parseInt(cw.weathercode));

    // Temperature
    if (els.currTemp) els.currTemp.textContent = `${cw.temperature.toFixed(1)}${tempSuffix()}`;
    if (els.condText) els.condText.textContent = wmo.label;

    // High/low from daily
    if (AppState.daily && els.highLow) {
        els.highLow.textContent = `H:${AppState.daily.temperature_2m_max[0]}${tempSuffix()} L:${AppState.daily.temperature_2m_min[0]}${tempSuffix()}`;
    }

    // Feels like (from hourly apparent_temperature at current hour)
    const hi = getCurrentHourIndex();
    if (AppState.hourly && AppState.hourly.apparent_temperature && els.feelTemp) {
        const appTemp = AppState.hourly.apparent_temperature[hi];
        els.feelTemp.textContent = appTemp != null ? `${appTemp.toFixed(0)}${tempSuffix()}` : '--';
    } else if (els.feelTemp) {
        els.feelTemp.textContent = `${cw.temperature.toFixed(0)}${tempSuffix()}`;
    }

    // Humidity
    if (AppState.hourly && AppState.hourly.relativehumidity_2m && els.humidity) {
        els.humidity.textContent = `${AppState.hourly.relativehumidity_2m[hi]}%`;
    }

    // Wind
    if (els.windSpeed) {
        els.windSpeed.textContent = `${cw.windspeed.toFixed(0)} ${speedLabel()}`;
    }

    // Precipitation probability
    if (AppState.hourly && AppState.hourly.precipitation_probability && els.precipProb) {
        const pp = AppState.hourly.precipitation_probability[hi];
        els.precipProb.textContent = pp != null ? `${pp}%` : '--';
    }

    // UV Index
    if (AppState.hourly && AppState.hourly.uv_index && els.uvIndex) {
        const uv = AppState.hourly.uv_index[hi];
        els.uvIndex.textContent = uv != null ? uv.toFixed(1) : '--';
    }
}

function renderHourlyForecast(hourly) {
    if (!els.hourlyList || !hourly) return;

    const now = new Date();
    const cwTime = AppState.currentWeather ? AppState.currentWeather.time : now.toISOString();
    const hourStr = cwTime.substring(0, 13);
    const startIdx = hourly.time.findIndex(t => t.startsWith(hourStr));
    const start = startIdx >= 0 ? startIdx : 0;

    const items = [];
    for (let i = start; i < Math.min(start + CONFIG.HOURLY_HOURS, hourly.time.length); i++) {
        if (!hourly.time[i]) break;
        const dt = new Date(hourly.time[i]);
        const hour = dt.getHours();
        const temp = hourly.temperature_2m ? hourly.temperature_2m[i] : '--';
        const code = hourly.weathercode ? hourly.weathercode[i] : 0;
        const wmo = interpretCode(code);
        const pp = hourly.precipitation_probability ? (hourly.precipitation_probability[i] || 0) : 0;

        items.push(`<div class="forecast-card" style="min-width:70px;text-align:center;padding:8px;border-radius:8px;border:1px solid rgba(255,255,255,0.1);background:rgba(16,24,39,0.75);">
            <div style="font-size:0.8rem;opacity:0.7;">${hour}:00</div>
            <div style="font-size:1.2rem;margin:4px 0;">${getIconSVG(wmo.cond)}</div>
            <div style="font-weight:600;">${typeof temp==='number'?temp.toFixed(0):temp}°</div>
            <div style="font-size:0.7rem;opacity:0.6;">${pp}%</div>
        </div>`);
    }

    els.hourlyList.innerHTML = `<div style="display:flex;gap:8px;overflow-x:auto;padding-bottom:8px;scrollbar-width:none;">${items.join('')}</div>`;
}

function renderDailyForecast(daily) {
    if (!els.dailyList || !daily) return;

    const items = [];
    for (let i = 0; i < Math.min(7, daily.time.length); i++) {
        const dt = new Date(daily.time[i]);
        const dayName = i === 0 ? 'Today' : dt.toLocaleDateString([], { weekday: 'short' });
        const maxT = daily.temperature_2m_max ? daily.temperature_2m_max[i] : '--';
        const minT = daily.temperature_2m_min ? daily.temperature_2m_min[i] : '--';
        const code = daily.weathercode ? daily.weathercode[i] : 0;
        const wmo = interpretCode(code);
        const pp = daily.precipitation_probability_max ? (daily.precipitation_probability_max[i] || 0) : 0;

        items.push(`<div style="display:flex;align-items:center;justify-content:space-between;padding:10px;border-radius:8px;border:1px solid rgba(255,255,255,0.08);background:rgba(16,24,39,0.75);margin-bottom:6px;">
            <span style="min-width:60px;font-weight:600;">${dayName}</span>
            <span style="font-size:1.2rem;">${getIconSVG(wmo.cond)}</span>
            <span style="min-width:50px;text-align:center;opacity:0.6;">${pp}%</span>
            <span style="min-width:80px;text-align:right;">${maxT}° / ${minT}°</span>
        </div>`);
    }

    els.dailyList.innerHTML = items.join('');
}

function getIconSVG(cond) {
    const svgs = {
        'clear': '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#aebfd6" stroke-width="1.5"><circle cx="12" cy="12" r="5"/><path d="M12 1v3M12 20v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M1 12h3M20 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1"/></svg>',
        'partly-cloudy': '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#aebfd6" stroke-width="1.5"><circle cx="9" cy="9" r="3"/><path d="M17 18a4 4 0 000-8 6 6 0 00-11 2"/></svg>',
        'overcast': '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#aebfd6" stroke-width="1.5"><path d="M17 18a4 4 0 000-8 6 6 0 00-11 2"/></svg>',
        'fog': '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#aebfd6" stroke-width="1.5"><path d="M3 8h18M3 12h18M3 16h18M3 20h14"/></svg>',
        'drizzle': '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#5de2ff" stroke-width="1.5"><path d="M17 14a4 4 0 000-8 6 6 0 00-11 2"/><path d="M8 18l-1 2M12 18l-1 2M16 18l-1 2"/></svg>',
        'rain': '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#5de2ff" stroke-width="1.5"><path d="M17 14a4 4 0 000-8 6 6 0 00-11 2"/><path d="M8 17v4M12 17v4M16 17v4"/></svg>',
        'heavy-rain': '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#5de2ff" stroke-width="1.5"><path d="M17 14a4 4 0 000-8 6 6 0 00-11 2"/><path d="M6 17v4M9 17v4M12 17v4M15 17v4M18 17v4"/></svg>',
        'snow': '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="1.5"><path d="M17 14a4 4 0 000-8 6 6 0 00-11 2"/><path d="M8 19l.5-1M12 20l.5-1M16 19l.5-1"/></svg>',
        'heavy-snow': '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="1.5"><path d="M17 14a4 4 0 000-8 6 6 0 00-11 2"/><path d="M6 19l1-2M9 20l1-2M12 19l1-2M15 20l1-2M18 19l1-2"/></svg>',
        'thunderstorm': '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#ffc66d" stroke-width="1.5"><path d="M17 14a4 4 0 000-8 6 6 0 00-11 2"/><path d="M13 14l-3 5h3l-2 4"/></svg>'
    };
    return svgs[cond] || svgs['clear'];
}

// ============================================================
// MOON WIDGET
// ============================================================
function renderMoonWidget(date) {
    const moon = calculateMoon(date);
    const times = approxMoonTimes(moon.phase, date);

    if (els.moonPhaseName) {
        els.moonPhaseName.textContent = moon.phaseName;
    }

    if (els.moonRiseSet) {
        const riseStr = times.rise.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        const setStr = times.set.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        els.moonRiseSet.textContent = `Rise: ${riseStr}  Set: ${setStr}`;
    }

    // Moon visual in the widget
    if (els.moonGauge) {
        const radius = 18;
        const offset = moon.illumination * 2 * radius;
        const shadowX = 50 + (moon.isWaxing ? -offset : offset);

        els.moonGauge.innerHTML = `<svg viewBox="0 0 100 100" style="width:100%;height:100%;">
            <circle cx="50" cy="50" r="${radius}" fill="#e8e0c0" />
            <circle cx="${shadowX}" cy="50" r="${radius}" fill="#1a1d2e" />
        </svg>`;
        els.moonGauge.style.boxShadow = 'inset -3px 0 8px rgba(0,0,0,0.4)';
    }
}

// ============================================================
// SETTINGS
// ============================================================
function loadSettingsIntoForm() {
    if (els.settingUnit) els.settingUnit.value = AppState.units;
    if (els.settingTheme) els.settingTheme.value = AppState.theme;
    if (els.settingMotionAuto) els.settingMotionAuto.checked = !AppState.forceReducedMotion;
    if (els.settingMotionForce) els.settingMotionForce.checked = AppState.forceReducedMotion;
}

function saveSettingsFromForm() {
    const prevUnits = AppState.units;
    if (els.settingUnit) {
        AppState.units = els.settingUnit.value;
        localStorage.setItem('wotn_units', AppState.units);
    }
    if (els.settingTheme) {
        AppState.theme = els.settingTheme.value;
        localStorage.setItem('wotn_theme', AppState.theme);
    }
    if (els.settingMotionForce) {
        AppState.forceReducedMotion = els.settingMotionForce.checked;
        localStorage.setItem('wotn_force_reduced', AppState.forceReducedMotion);
        checkReducedMotion();
    }

    // Re-render if settings changed
    if (AppState.currentWeather) {
        if (prevUnits !== AppState.units) {
            fetchWeather();
        } else {
            renderScene(AppState.currentWeather);
        }
    }
}

// ============================================================
// REDUCED MOTION
// ============================================================
function checkReducedMotion() {
    const systemPrefers = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    AppState.reducedMotion = systemPrefers || AppState.forceReducedMotion;
}

// ============================================================
// OFFLINE CACHING
// ============================================================
function cacheWeatherData(data) {
    try {
        localStorage.setItem('wotn_cache', JSON.stringify(data));
        localStorage.setItem('wotn_cache_time', new Date().toISOString());
    } catch (e) { /* storage may be full */ }
}

function loadCachedWeather() {
    try {
        const cached = localStorage.getItem('wotn_cache');
        if (!cached) return false;
        const data = JSON.parse(cached);
        const cacheTime = localStorage.getItem('wotn_cache_time');

        AppState.isCached = true;
        AppState.utcOffset = data.utc_offset_seconds || 0;
        processWeather(data);

        if (cacheTime && els.locDisplay) {
            const age = Math.round((Date.now() - new Date(cacheTime).getTime()) / 60000);
            const baseName = AppState.locationName || 'Cached Location';
            els.locDisplay.textContent = `${baseName} (cached ${age}m ago)`;
        }

        showStatus('Showing cached weather data. Pull to refresh.');
        return true;
    } catch (e) {
        return false;
    }
}

// ============================================================
// VISIBILITY / PERFORMANCE
// ============================================================
function onVisibilityChange() {
    if (document.hidden) {
        if (AppState.refreshTimer) { clearTimeout(AppState.refreshTimer); AppState.refreshTimer = null; }
        if (els.envLayer) els.envLayer.style.animationPlayState = 'paused';
        const anims = els.envLayer ? els.envLayer.querySelectorAll('*') : [];
        anims.forEach(el => { el.style.animationPlayState = 'paused'; });
    } else {
        if (els.envLayer) {
            const anims = els.envLayer.querySelectorAll('*');
            anims.forEach(el => { el.style.animationPlayState = 'running'; });
        }
        // Refresh if data is stale
        if (AppState.lastUpdated) {
            const age = Date.now() - AppState.lastUpdated.getTime();
            if (age > CONFIG.REFRESH_INTERVAL) {
                fetchWeather();
            } else {
                AppState.refreshTimer = setTimeout(fetchWeather, CONFIG.REFRESH_INTERVAL - age);
            }
        }
    }
}

// ============================================================
// ERROR HANDLING / STATUS
// ============================================================
function showError(msg) {
    if (els.alertBanner) {
        els.alertBanner.classList.remove('hidden');
        if (els.alertTitle) els.alertTitle.textContent = 'Notice';
        if (els.alertMsg) els.alertMsg.textContent = msg;
    }
}

function showStatus(msg) {
    if (els.alertBanner) {
        els.alertBanner.classList.remove('hidden');
        if (els.alertTitle) els.alertTitle.textContent = '';
        if (els.alertMsg) els.alertMsg.textContent = msg;
    }
    // Auto-clear after 5s
    setTimeout(() => {
        if (els.alertBanner && AppState.currentWeather) {
            els.alertBanner.classList.add('hidden');
        }
    }, 5000);
}

function clearError() {
    if (els.alertBanner) els.alertBanner.classList.add('hidden');
}

// ============================================================
// SERVICE WORKER
// ============================================================
function registerSW() {
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('./service-worker.js').catch(err => {
            console.warn('SW registration failed:', err);
        });
    }
}

// ============================================================
// START
// ============================================================
window.addEventListener('DOMContentLoaded', init);

})();
