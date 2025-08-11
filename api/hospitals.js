// CORS ヘッダー設定ヘルパ
const setCors = (res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
};

// 直線距離（メートル）
function haversine(lat1,lng1,lat2,lng2){
  const toRad = d => d*Math.PI/180, R=6371000;
  const dLat = toRad(lat2-lat1), dLng = toRad(lng2-lng1);
  const a = Math.sin(dLat/2)**2 + Math.cos(toRad(lat1))*Math.cos(toRad(lat2))*Math.sin(dLng/2)**2;
  return 2*R*Math.asin(Math.sqrt(a));
}

export default async function handler(req, res) {
  try {
    setCors(res);
    if (req.method === 'OPTIONS') return res.status(200).end();

    const { lat, lng, day = 'today' } = req.query;
    if (!lat || !lng) return res.status(400).json({ error: 'lat,lng required' });

    const GOOGLE_KEY = process.env.GOOGLE_MAPS_API_KEY;
    if (!GOOGLE_KEY) {
      // 環境変数未設定時の見つけやすいエラー
      return res.status(500).json({ error: 'missing_env_GOOGLE_MAPS_API_KEY' });
    }

    const WALK_RADIUS_M = 1600; // 徒歩20分≒1.6km
    const types = ['hospital','doctor'];

    // Nearby Search
    const all = [];
    for (const type of types) {
      const u = new URL('https://maps.googleapis.com/maps/api/place/nearbysearch/json');
      u.searchParams.set('location', `${lat},${lng}`);
      u.searchParams.set('radius', WALK_RADIUS_M);
      u.searchParams.set('type', type);
      u.searchParams.set('language', 'ja');
      u.searchParams.set('key', GOOGLE_KEY);
      const r = await fetch(u);
      const j = await r.json();
      if (j?.results?.length) all.push(...j.results);
    }

    // 重複除去 → 上位20件だけ詳細
    const unique = new Map();
    all.forEach(p => unique.set(p.place_id, p));
    const subset = Array.from(unique.values()).slice(0, 20);

    const detailed = [];
    for (const p of subset) {
      const u = new URL('https://maps.googleapis.com/maps/api/place/details/json');
      u.searchParams.set('place_id', p.place_id);
      u.searchParams.set('fields', 'name,formatted_address,formatted_phone_number,website,geometry,opening_hours');
      u.searchParams.set('language', 'ja');
      u.searchParams.set('key', GOOGLE_KEY);
      const r = await fetch(u);
      const j = await r.json();
      if (j.result) detailed.push(j.result);
    }

    // 今日/明日の営業判定（weekday_textベースのざっくり）
    const base = new Date();
    if (day === 'tomorrow') base.setDate(base.getDate() + 1);
    const dayIdx = base.getDay(); // 0=Sun..6=Sat
    const names = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];

    const filtered = detailed.filter(d => {
      const lines = d.opening_hours?.weekday_text;
      if (!Array.isArray(lines)) return true; // 情報なしは許容
      const line = lines.find(s => s.startsWith(names[dayIdx]));
      if (!line) return true;
      return !/closed/i.test(line);
    });

    const items = filtered.map(d => {
      const lat2 = d.geometry?.location?.lat;
      const lng2 = d.geometry?.location?.lng;
      const dist = (lat2 && lng2) ? haversine(+lat,+lng,+lat2,+lng2) : null;
      const walk = dist ? Math.round(dist / 80) : null; // 80m/分 ≒ 4.8km/h
      const maps = (lat2 && lng2)
        ? `https://www.google.com/maps/dir/?api=1&origin=${lat},${lng}&destination=${lat2},${lng2}&travelmode=walking`
        : null;
      return {
        name: d.name,
        address: d.formatted_address ?? null,
        phone: d.formatted_phone_number ?? null,
        website: d.website ?? null,
        opening_hours: d.opening_hours?.weekday_text ?? null,
        walk_minutes: walk,
        maps_url: maps,
      };
    }).sort((a,b) => (a.walk_minutes ?? 999) - (b.walk_minutes ?? 999));

    return res.status(200).json({ day, count: items.length, items });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: 'server_error', detail: String(e?.message || e) });
  }
}
