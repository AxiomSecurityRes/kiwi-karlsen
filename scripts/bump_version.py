#!/usr/bin/env python3
"""버전 올리기 — 배포 전에 한 번 실행하세요.

  python scripts/bump_version.py 16

다음을 한꺼번에 바꿉니다.
  1. backend/config.py 의 VERSION
  2. 모든 HTML 의 <script src="/js/*.js?v=NN"> / <link href="/css/*.css?v=NN">
  3. 모든 HTML 푸터의 "· vNN"

왜 필요한가:
브라우저는 /js/api.js 같은 파일을 캐시합니다. 버전 쿼리(?v=16)가 바뀌지 않으면
브라우저가 옛 api.js 를 계속 쓰고, 새 profile.js 와 섞여
"API.profileUpdate is not a function" 같은 오류가 납니다.
"""
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def main() -> int:
    if len(sys.argv) < 2 or not sys.argv[1].strip().lstrip("v").isdigit():
        print("사용법: python scripts/bump_version.py <번호>   (예: 16)")
        return 1
    num = sys.argv[1].strip().lstrip("v")
    ver = f"v{num}"

    # 1) backend/config.py
    cfg_path = os.path.join(ROOT, "backend", "config.py")
    cfg = open(cfg_path, encoding="utf-8").read()
    new_cfg, n = re.subn(r'VERSION: str = "v\d+"', f'VERSION: str = "{ver}"', cfg)
    if n:
        open(cfg_path, "w", encoding="utf-8").write(new_cfg)
        print(f"  config.py       → VERSION = {ver}")

    # 2) + 3) HTML
    front = os.path.join(ROOT, "frontend")
    for name in sorted(os.listdir(front)):
        if not name.endswith(".html"):
            continue
        path = os.path.join(front, name)
        html = open(path, encoding="utf-8").read()
        orig = html
        html = re.sub(r'(src="/js/[\w.-]+\.js)(\?v=\d+)?"', rf'\1?v={num}"', html)
        html = re.sub(r'(href="/css/[\w.-]+\.css)(\?v=\d+)?"', rf'\1?v={num}"', html)
        html = re.sub(r'· v\d+<', f'· {ver}<', html)
        # 버전 감시기가 비교하는 메타 태그
        html = re.sub(r'(<meta name="kiwi-version" content=")\d+(" />)',
                      rf'\g<1>{num}\g<2>', html)
        # 내비게이션 링크 (캐시된 옛 페이지로 이동하지 않도록)
        for page in ("index", "play", "puzzles", "openings", "analysis", "profile", "admin"):
            html = re.sub(rf'href="/{page}\.html(\?v=\d+)?"', f'href="/{page}.html?v={num}"', html)
        if html != orig:
            open(path, "w", encoding="utf-8").write(html)
            print(f"  {name:18} → ?v={num}, 푸터 {ver}")

    # api.js 의 KIWI_VERSION (JS 안에서 만드는 링크용)
    api_path = os.path.join(front, "js", "api.js")
    if os.path.exists(api_path):
        api = open(api_path, encoding="utf-8").read()
        new_api, k = re.subn(r'window\.KIWI_VERSION = "\d+";',
                             f'window.KIWI_VERSION = "{num}";', api)
        if k:
            open(api_path, "w", encoding="utf-8").write(new_api)
            print(f"  api.js             → KIWI_VERSION = {num}")

    print(f"\n완료. 이제 커밋 후 푸시하세요:")
    print(f'  git add . && git commit -m "{ver}" && git push')
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
