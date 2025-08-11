const API_BASE = 'https://YOUR-VERCEL-DEPLOYMENT.vercel.app/api/hospitals'; // ← あとで差し替え

const $status = document.getElementById('status');
const $list = document.getElementById('list');
const $day = document.getElementById('day');
document.getElementById('search').addEventListener('click', run);

async function run(){
  $status.textContent = '現在地を取得中…';
  $list.innerHTML = '';
  try{
    const pos = await getPosition();
    const { latitude:lat, longitude:lng } = pos.coords;
    $status.textContent = '検索中…';
    const url = `${API_BASE}?lat=${lat}&lng=${lng}&day=${$day.value}`;
    const r = await fetch(url);
    const j = await r.json();
    $status.textContent = `検索完了：${j.count}件`;
    render(j.items);
  }catch(e){
    console.error(e);
    $status.textContent = 'エラーが発生しました。位置情報の許可やネットワークをご確認ください。';
  }
}

function render(items){
  $list.innerHTML = items.map(it => `
    <div class="card">
      <div><strong>${esc(it.name)}</strong>（徒歩${it.walk_minutes ?? '-'}分）</div>
      <div class="muted">${esc(it.address ?? '')}</div>
      ${it.phone ? `<div>☎ ${esc(it.phone)}</div>` : ''}
      ${it.website ? `<div><a href="${it.website}" target="_blank" rel="noopener">公式サイト</a></div>` : ''}
      ${it.maps_url ? `<div><a href="${it.maps_url}" target="_blank" rel="noopener">経路案内</a></div>` : ''}
      ${Array.isArray(it.opening_hours) ? `<details><summary>営業時間</summary><div class="muted">${it.opening_hours.map(esc).join('<br>')}</div></details>` : ''}
    </div>
  `).join('');
}

function getPosition(){
  return new Promise((resolve, reject)=>{
    navigator.geolocation.getCurrentPosition(resolve, reject, { enableHighAccuracy:true, timeout:10000 });
  });
}

function esc(s){ return String(s).replace(/[&<>"']/g, m=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[m])); }
