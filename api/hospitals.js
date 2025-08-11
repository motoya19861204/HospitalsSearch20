// api/hospitals.js
import fetch from 'node-fetch';

const GOOGLE_API = 'https://maps.googleapis.com/maps/api/place';
const WALK_RADIUS_M = 1600; // 徒歩20分 ≒ 1.6km（時速約4.8kmを仮定）

function isOpenOn(targetDayIndex, openingHours) {
  // openingHours.weekday_text 形式をざっくり判定
  // targetDayIndex: 0=Sun ... 6=Sat（JS Date準拠）
  if (!openingHours?.weekday_text) return true; // 情報なければ「許容」方針
  const mapIdx = [7,1,2,3,4,5,6]; // Googleは Mon=1…Sun=7 の並びことが多い対策
  const line = openingHours.weekday_text.find(l => {
    // "Monday: 9:00 – 17:00" のような文字列を含むかで判定
    const names = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
    return l.startsWith(names[targetDayIndex]);
  });
  if (!line) return true;
  // "Closed" を含んでいたら休業とみなす（昼休みなど詳細はまず無視）
  return !/closed/i.test(line);
}

export default async function handler(req, res) {
  try {
    const { lat, lng, day = 'today' } = req.query;
    if (!lat || !lng) return res.status(400).json({ error: 'lat,lng required' });

    // 1) Nearby Search（type=hospital と doctor の2回をマージ）
    const types = ['hospital','doctor'];
    const results = [];
    for (const type of types) {
      const url = `${GOOGLE_API}/nearbysearch/json?location=${lat},${lng}&radius=${WALK_RADIUS_M}&type=${type}&language=ja&key=${process.env.GOOGLE_MAPS_API_KEY}`;
      const r = await fetch(url);
      const j = await r.json();
      if (j.results?.length) results.push(...j.results);
    }

    // 2) Place Detailsで営業時間や電話番号など取得（必要最低限）
    //    呼び出し回数を抑えるため上位20件程度に制限
    const unique = new Map();
    results.forEach(p => unique.set(p.place_id, p));
    const subset = Array.from(unique.values()).slice(0, 20);

    const detailed = [];
    for (const p of subset) {
      const detUrl = `${GOOGLE_API}/details/json?place_id=${p.place_id}&fields=name,formatted_address,formatted_phone_number,website,geometry,opening_hours,utc_offset_minutes&language=ja&key=${process.env.GOOGLE_MAPS_API_KEY}`;
      const r = await fetch(detUrl);
      const j = await r.json();
      if (j.result) detailed.push(j.result);
    }

    // 3) 今日/明日営業しているか判定
    const base = new Date();
    if (day === 'tomorrow') base.setDate(base.getDate() + 1);
    const dayIdx = base.getDay(); // 0=Sun ... 6=Sat

    const filtered = detailed.filter(d => isOpenOn(dayIdx, d.opening_hours));

    // 4) 徒歩時間の目安と経路リンク付与
    const withMeta = filtered.map(d => {
      const lat2 = d.geometry?.location?.lat;
      const lng2 = d.geometry?.location?.lng;
      const distM = lat2 && lng2 ? haversine(+lat, +lng, +lat2, +lng2) : null;
      const walkMin = distM ? Math.round(distM / (80)) : null; // 徒歩80m/分 ≒ 4.8km/h
      const mapsUrl = lat2 && lng2
        ? `https://www.google.com/maps/dir/?api=1&origin=${lat},${lng}&destination=${lat2},${lng2}&travelmode=walking`
        : null;
      return {
        name: d.name,
        address: d.formatted_address,
        phone: d.formatted_phone_number || null,
        website: d.website || null,
        opening_hours: d.opening_hours?.weekday_text || null,
        walk_minutes: walkMin,
        maps_url: mapsUrl
      };
    }).sort((a,b) => (a.walk_minutes ?? 999) - (b.walk_minutes ?? 999));

    res.status(200).json({ day, count: withMeta.length, items: withMeta });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'server_error' });
  }
}

// 簡易ハバーサイン（メートル）
function haversine(lat1,lng1,lat2,lng2){
  const toRad = d => d*Math.PI/180;
  const R = 6371000;
  const dLat = toRad(lat2-lat1);
  const dLng = toRad(lng2-lng1);
  const a = Math.sin(dLat/2)**2 +
            Math.cos(toRad(lat1))*Math.cos(toRad(lat2))*
            Math.sin(dLng/2)**2;
  return 2*R*Math.asin(Math.sqrt(a));
}
