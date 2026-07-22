// ============================================================
//  share.js — 대표님께 공유(읽기전용 웹 링크 + 암호) 관리 모달
//  · 링크/암호는 이 PC(localStorage)에 저장 → 언제든 복사해서 전달
//  · 데이터가 바뀌면 프로젝트 폴더의 "공유-업데이트.bat" 실행으로 최신화
// ============================================================
window.Share = (function () {
  const { esc, toast, modal } = UI;
  const KEY = 'mm-share-info';

  function load() {
    // 1) 배포 스크립트가 심어둔 config/share.config.js 값 우선
    const cfg = window.MM_SHARE || {};
    // 2) 사용자가 앱에서 저장한 값
    let saved = {};
    try { saved = JSON.parse(localStorage.getItem(KEY) || '{}'); } catch {}
    return {
      url: saved.url || cfg.url || '',
      passcode: saved.passcode || cfg.passcode || '',
      updatedAt: saved.updatedAt || cfg.updatedAt || ''
    };
  }
  function save(info) {
    try { localStorage.setItem(KEY, JSON.stringify(info)); } catch {}
  }

  async function copy(text) {
    if (!text) return false;
    try {
      if (window.mm && window.mm.writeClipboard) { await window.mm.writeClipboard(text); return true; }
      if (navigator.clipboard && navigator.clipboard.writeText) { await navigator.clipboard.writeText(text); return true; }
    } catch {}
    try {
      const ta = document.createElement('textarea');
      ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.select();
      const ok = document.execCommand('copy'); ta.remove(); return ok;
    } catch { return false; }
  }

  function messageText(info) {
    return [
      '[MM 프로젝트 진행현황]',
      '아래 링크로 언제든 최신 현황을 보실 수 있습니다.',
      '',
      '링크: ' + (info.url || '(주소 미설정)'),
      '열람 암호: ' + (info.passcode || '(암호 미설정)'),
      '',
      '※ 암호를 입력해야 열립니다. 링크와 암호는 대표님만 알고 계시면 됩니다.'
    ].join('\n');
  }

  function open() {
    const info = load();
    const has = !!info.url;
    const body = `
      <div class="share-box">
        <p class="share-lead">대표님은 아래 <b>링크 + 암호</b>로 언제든 최신 진행현황을 열람할 수 있습니다.
        고객정보 보호를 위해 <b>암호를 입력해야만</b> 열리도록 암호화되어 있습니다.</p>

        <label class="share-lb">공유 링크</label>
        <div class="share-row">
          <input id="sh-url" type="text" value="${esc(info.url)}" placeholder="배포 후 생성된 주소 (예: https://...github.io/...)" />
          <button class="btn ghost" data-copy="url">복사</button>
        </div>

        <label class="share-lb">열람 암호</label>
        <div class="share-row">
          <input id="sh-pass" type="text" value="${esc(info.passcode)}" placeholder="대표님께 알려줄 암호" />
          <button class="btn ghost" data-copy="pass">복사</button>
        </div>

        <button class="btn primary share-msg" data-copy="msg">📋 링크+암호 한 번에 복사 (카톡·메일 붙여넣기용)</button>

        ${has ? `<a class="share-open" href="${esc(info.url)}" target="_blank" rel="noopener">↗ 공유 페이지 미리보기</a>` : ''}
        ${info.updatedAt ? `<div class="share-meta">마지막 공유 업데이트: ${esc(info.updatedAt)}</div>` : ''}

        <div class="share-note">
          <b>현황이 바뀌면?</b> 프로젝트 폴더의 <code>공유-업데이트.bat</code> 을 더블클릭하면
          최신 데이터로 공유 페이지가 갱신됩니다. (링크·암호는 그대로 유지)
        </div>
      </div>`;

    modal({
      title: '🔗 대표님께 공유',
      bodyHTML: body,
      saveLabel: '링크·암호 저장',
      onOpen(el) {
        el.querySelectorAll('[data-copy]').forEach(b => b.addEventListener('click', async () => {
          const kind = b.dataset.copy;
          const cur = {
            url: el.querySelector('#sh-url').value.trim(),
            passcode: el.querySelector('#sh-pass').value.trim()
          };
          const text = kind === 'url' ? cur.url : kind === 'pass' ? cur.passcode : messageText(cur);
          const ok = await copy(text);
          toast(ok ? '복사했습니다' : '복사 실패 — 직접 선택해 복사하세요');
        }));
      },
      onSave(el) {
        const info2 = {
          url: el.querySelector('#sh-url').value.trim(),
          passcode: el.querySelector('#sh-pass').value.trim(),
          updatedAt: load().updatedAt
        };
        save(info2);
        toast('공유 정보를 저장했습니다');
      }
    });
  }

  return { open, load };
})();
