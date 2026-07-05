/**
 * Whiskers of the Night Weather
 * Core Logic Module
 */

const AppState = {
    lat: null, lon: null, locationName: '',
    units: localStorage.getItem('wotn_units') || 'metric', // metric | imperial
    theme: localStorage.getItem('wotn_theme') || 'auto',   // auto | night
    reducedMotion: false,
    currentWeather: null,
    forecast: null,
    lastUpdated: null
};

// DOM Elements
const els = {
    locDisplay: document.getElementById('location-display'),
    currTemp: document.getElementById('curr-temp'),
    condText: document.getElementById('condition-text'),
    highLow: document.getElementById('high-low'),
    feelTemp: document.getElementById('feel-temp'),
    humidity: document.getElementById('humidity'),
    windSpeed: document.getElementById('wind-speed'),
    precipProb: document.getElementById('precip-prob'),
    uvIndex: document.getElementById('uv-index'),
    moonPhase: document.getElementById('moon-phase-name'),
    moonVis: document.getElementById('moon-gauge'),
    moonRiseSet: document.getElementById('moon-rise-set'),
    hourlyList: document.getElementById('hourly-list'),
    dailyList: document.getElementById('daily-list'),
    envLayer: document.getElementById('environment-layer'),
    sceneRoot: document.getElementById('scene-root'),
    alertBanner: document.getElementById('alert-banner'),
    drawer: document.getElementById('forecast-drawer')
};

// --- INITIALIZATION ---

async function init() {
    checkReducedMotion();
    setupEventListeners();
    
    // Try Geo first
    if ('geolocation' in navigator) {
        navigator.geolocation.getCurrentPosition(async pos => {
            setState(pos.coords.latitude, pos.coords.longitude, true);
        }, async err => {
            console.warn("Geo denied", err);
            tryAutoLocation();
        });
    } else {
        tryAutoLocation();
    }
    
    registerSW();
}

function tryAutoLocation() {
    // Fallback: User IP approximate location (requires external API) or just ask manually
    // For this pure demo, we'll wait for manual input or stored geo
    const savedLat = parseFloat(localStorage.getItem('wotn_lat'));
    const savedLon = parseFloat(localStorage.getItem('wotn_lon'));
    if(savedLat && savedLon) {
        setState(savedLat, savedLon, true);
    } else {
        showNotification("Please enable location or enter city manually.");
        setTimeout(() => document.getElementById('btn-settings').click(), 2000);
    }
}

function setupEventListeners() {
    document.getElementById('btn-location').addEventListener('click', () => {
         if(navigator.geolocation) navigator.geolocation.getCurrentPosition(p => setState(p.coords.lat||p.coords.latitude, p.coords.lon||p.coords.longitude, true));
    });
    
    document.getElementById('toggle-forecast').addEventListener('click', () => {
        els.drawer.classList.toggle('hidden');
    });

    // Modal Handlers
    const settingsBtn = document.getElementById('btn-settings');
    const sModal = document.getElementById('settings-modal');
    const searchModal = document.getElementById('search-modal');
    const searchTrigger = document.getElementById('manual-search-trigger');
    const searchForm = document.getElementById('search-form');
    const settingsForm = document.getElementById('settings-form');

    settingsBtn.addEventListener('click', () => {
        sModal.showModal();
        loadSettings(sModal);
    });

    sModal.querySelector('form').addEventListener('close', saveSettings);

    searchTrigger.addEventListener('click', () => {
        sModal.close();
        searchModal.showModal();
    });

    searchForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const q = document.getElementById('city-input').value;
        if(!q) return;
        
        // Geocoding via OpenMeteo
        const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(q)}&count=5`;
        try {
            const res = await fetch(url);
            const data = await res.json();
            renderResults(data.results, searchModal);
        } catch(err) { showNotification("Geocoding failed."); }
    });

    // Inputs change listeners
    document.querySelectorAll('#setting-unit, #setting-theme').forEach(el => {
        el.addEventListener('change', (e) => {
            if(e.target.id === 'setting-unit') updateUnitLabels(AppState.currentWeather);
        })
    });
}

// --- CORE LOGIC: STATE & API ---

function setState(lat, lon, refreshData = false) {
    AppState.lat = lat;
    AppState.lon = lon;
    localStorage.setItem('wotn_lat', lat);
    localStorage.setItem('wotn_lon', lon);
    els.locDisplay.textContent = "Updating Sky...";

    if(refreshData) fetchData();
}

async function fetchData() {
    const unitParam = AppState.units === 'metric' ? 'celsius' : 'fahrenheit';
    const windUnit = AppState.units === 'metric' ? 'kmh' : 'mph';
    
    const wUrl = `https://api.open-meteo.com/v1/forecast?latitude=${AppState.lat}&longitude=${AppState.lon}&current_weather=true&hourly=temperature_2m,weathercode,precipitation_probability,rain,snowfall,windspeed,direct_radiation&daily=weathercode,temperature_2m_max,temperature_2m_min,sunrise,sunset&timezone=auto&wind_speed_unit=${windUnit}`;
    
    try {
        const res = await fetch(wUrl);
        if (!res.ok) throw new Error('Network error');
        const data = await res.json();
        
        AppState.currentWeather = data.current_weather;
        AppState.hourly = data.hourly;
        AppState.forecast = data.daily;
        AppState.lastUpdated = new Date().toISOString();
        
        processWeatherData(data);
    } catch (err) {
        console.error(err);
        els.alertBanner.classList.remove('hidden');
        els.alertBanner.textContent = "Connection lost to Observatory.";
        els.currTemp.textContent = "--°";
    }
}

function processWeatherData(data) {
    updateUI(currentToDisplay(data.current_weather));
    renderForecasts(data.hourly, data.daily);
    renderMoon(new Date()); // Pass current date
    renderSceneEnvironment(data.current_weather);
    els.locDisplay.textContent = getLocalizedNameFromCoords(AppState.lat, AppState.lon) || "Local Area"; // Ideally reverse lookup
    
    // Attempt reverse geocoding for nicer name (optional, can add here)
    fetch(`https://geocoding-api.open-meteo.com/v1/reverse?latitude=${AppState.lat}&longitude=${AppState.lon}`).then(r=>r.json()).then(d => {
        if(d.addresses?.[0]) els.locDisplay.textContent = `${d.addresses[0].name}, ${d.addresses[0].country_code}`;
    }).catch(()=>{});
}

// --- MOON CALCULATION ---

function renderMoon(date) {
    const dayOfYear = Math.floor((date - new Date(date.getFullYear(), 0, 0)) / 1000 / 60 / 60 / 24);
    // Approximation formula for synodic month
    let c = (dayOfYear % 29.53058867);
    let percent = (Math.cos(Math.PI * c / 14.765) + 1) / 2;
    // Adjust phase cycle start
    let moonAge = ((dayOfYear + 2.3) % 29.53058867); 
    
    // Determine Visual Phase Style
    // 0 = New, 7.3 = First Quarter, 14.7 = Full, 22 = Last Quarter
    let phaseStr = '';
    if(moonAge < 1.5) phaseStr = 'new';
    else if(moonAge < 5) phaseStr = 'waxing-crescent';
    else if(moonAge < 8.5) phaseStr = 'first-quarter';
    else if(moonAge < 12) phaseStr = 'waxing-gibbous';
    else if(moonAge < 16.5) phaseStr = 'full';
    else if(moonAge < 20) phaseStr = 'waning-gibbous';
    else if(moonAge < 23.5) phaseStr = 'last-quarter';
    else if(moonAge < 28) phaseStr = 'waning-crescent';
    else phaseStr = 'new';

    els.moonPhase.textContent = phaseStr.replace('-', ' ');
    
    // Render simple CSS shadow logic for moon
    // Using clip-path or box-shadow trick
    const vis = els.moonVis;
    vis.innerHTML = `<div style='background:#fff'></div>`;
    const dot = vis.firstElementChild;
    
    // Simplified visual representation
    if(phaseStr.includes('quarter')) dot.style.clipPath = 'inset(0% 50% 0% 0%)'; 
    else if(phaseStr.includes('gibbous')) dot.style.clipPath = 'inset(0% 20% 0% 0%)'; 
    else if(phaseStr.includes('crescent')) dot.style.clipPath = 'inset(0% 80% 0% 0%)'; 
    else dot.style.opacity = 0.05; // Dark
}

// --- RENDERING & ART SYSTEM ---

function currentToDisplay(curr) {
    const code = parseInt(curr.weathercode);
    let condition = 'Clear';
    let catMode = 'sit'; // sit, sleep, look
        
    // Map WMO codes
    if([0, 1].includes(code)) condition = 'Clear Skies';
    else if([2, 3].includes(code)) condition = 'Partly Cloudy';
    else if([45, 48].includes(code)) condition = 'Foggy';
    else if([51, 53, 55, 56, 57].includes(code)) condition = 'Drizzle';
    else if([61, 63, 65].includes(code)) condition = 'Rain';
    else if([71, 73, 75, 77].includes(code)) condition = 'Snow';
    else if([80, 81, 82].includes(code)) condition = 'Heavy Rain';
    else if([85, 86].includes(code)) condition = 'Snow Showers';
    else if([95, 96, 99].includes(code)) { condition = 'Thunderstorm'; catMode = 'watch'; }

    return { ...curr, humanCondition: condition, mood: catMode };
}

function updateUI(disp) {
    const t = disp.temperature;
    els.currTemp.textContent = `${t.toFixed(1)}°${AppState.units === 'metric'?'C':'F'}`;
    els.condText.textContent = disp.humanCondition;
    els.highLow.textContent = `H:--° L:--°`; // Populate from forecast later ideally
    
    // Fetch Hourly for High/Low approximation
        if(AppState.forecast) {
        els.highLow.textContent = `H:${AppState.forecast.temperature_2m_max[0]}° L:${AppState.forecast.temperature_2m_min[0]}°`;
        }
    
        els.feelTemp.textContent = `Feels like ${disp.temperature}°`;
        els.windSpeed.textContent = `${disp.windspeed} ${AppState.units==='metric'?'km/h':'mph'}`;
    
    // Details need fetching from hourly or current specific fields
    // Assuming some extra params were requested, for now using available
}

function renderForecasts(hourly, daily) {
    // Hourly
    els.hourlyList.innerHTML = hourly.time.slice(0, 24).map((t, i) => {
        const hour = new Date(t).getHours();
        const temp = hourly.temperature_2m[i];
        const icon = getSimpleIcon(hourly.weathercode[i]);
        return `
        <div class="forecast-card">
            <div>${hour}:00</div>
            <div>${icon}</div>
            <div>${temp}°</div>
        </div>`;
    }).join('');

    // Daily
    els.dailyList.innerHTML = daily.time.map((t, i) => {
        const d = new Date(t);
        const dayName = d.toLocaleDateString([], {weekday:'short'});
        return `
        <div class="forecast-card" style="display:flex;justify-content:space-between;margin-bottom:8px;">
           <span>${dayName}</span>
           <span>${getSimpleIcon(daily.weathercode[i])}</span>
           <span>${daily.temperature_2m_max[i]}°/${daily.temperature_2m_min[i]}°</span>
        </div>`;
    }).join('');
}

function getSimpleIcon(code) {
    // Mapping WMO to Emoji/Fallback text for brevity in loop
    // In prod, use SVG paths
    if(code <= 1) return '🌑☀️'; 
    if(code > 94) return '⚡';
    if(code > 60) return '❄️';
    if(code > 40) return '💧';
    return '☁️';
}

function renderSceneEnvironment(curr) {
    const cleanEnv = els.envLayer.innerHTML = ""; // Clear dynamic layers
    const bg = els.sceneRoot;
    
    // 1. Day/Night Cycle
    const now = new Date();
    const sunriseStr = AppState.forecast.sunrise ? AppState.forecast.sunrise[0] : null;
    const sunsetStr = AppState.forecast.sunset ? AppState.forecast.sunset[0] : null;
    const sunrise = sunriseStr ? new Date(sunriseStr) : new Date(now);
    sunrise.setHours(6, 0, 0, 0);
    const sunset = sunsetStr ? new Date(sunsetStr) : new Date(now);
    sunset.setHours(18, 0, 0, 0);
    
    // Theme Override
    if(AppState.theme === 'night') { isDay = false; }

    // 2. Gradient Background
    if(isDay) {
        bg.style.background = "linear-gradient(to bottom, #6faec8, #dbeafe)";
        document.body.style.backgroundColor = "#ffffff"; // Bright base
    } else {
        bg.style.background = "linear-gradient(to bottom, #0f172a, #1e1b4b)";
        document.body.style.backgroundColor = "#000000";
    }

    // 3. Moon Rendering (Only visible at night usually)
    if(!isDay) {
       const moonEl = document.createElement('div');
       moonEl.className = 'moon-element';
       moonEl.style.position = 'absolute';
       moonEl.style.right = '15%';
       moonEl.style.top = '20%';
       moonEl.style.width = '60px';
       moonEl.style.height = '60px';
       moonEl.style.borderRadius = '50%';
       moonEl.style.backgroundColor = '#ffd700';
       moonEl.style.boxShadow = '0 0 20px #ffffaa';
       els.envLayer.appendChild(moonEl);
       
       // Calculate phase mask
       const moonDot = moonEl.firstChild || document.createElement('div');
       moonEl.prepend(moonDot);
       moonDot.style.cssText = "position:absolute; inset:0; background:black; clip-path: polygon(0 0, 100% 0, 100% 100%, 0 100%);"; // Logic simplified
    }

    // 4. Stars (If clear night)
    if(!isDay && [0,1,2].includes(parseInt(curr.weathercode))) {
        for(let i=0; i<30; i++) {
            const s = document.createElement('div');
            s.style.cssText = `position:absolute; width:2px; height:2px; background:white; left:${Math.random()*100}%; top:${Math.random()*60}%; opacity:${Math.random()}`;
            els.envLayer.appendChild(s);
        }
    }

    // 5. Precipitation
    if(curr.weathercode > 50 && curr.weathercode < 70 && AppState.reducedMotion !== true) {
        createParticles('rain', 80);
    }
    if(curr.weathercode >= 71 && curr.weathercode < 80 && AppState.reducedMotion !== true) {
        createParticles('snow', 50);
    }
    if(curr.weathercode >= 80 && curr.weathercode < 90 && AppState.reducedMotion !== true) {
        createParticles('rain', 120);
    }

function createParticles(type, count) {
    const frag = document.createDocumentFragment();
    for(let i=0; i<count; i++) {
        const p = document.createElement('div');
        p.className = type === 'rain' ? 'rain-drop' : 'snow-flake';
        p.style.left = Math.random() * 100 + '%';
        p.style.animationDuration = (Math.random() * 2 + 1) + 's';
        p.style.animationDelay = Math.random() + 's';
        if(type === 'snow') p.style.transform = `scale(${Math.random()})`;
        frag.appendChild(p);
    }
    els.envLayer.appendChild(frag);
}

function checkReducedMotion() {
    AppState.reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function updateUnitLabels(curr) {
    // Refresh display values to match units
    els.currTemp.textContent = `${curr.temperature}°${AppState.units==='metric'?'C':'F'}`;
    els.windSpeed.textContent = `${curr.windspeed} ${AppState.units==='metric'?'km/h':'mph'}`;
}

function getLocalizedNameFromCoords(lat, lon) {
    // Reverse geocoding stub
    return "Coordinates Saved";
}

function registerSW() {
    if('serviceWorker' in navigator) {
        navigator.serviceWorker.register('service-worker.js').catch(console.error);
    }
}

window.onload = init;
