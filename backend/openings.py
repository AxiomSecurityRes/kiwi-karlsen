"""오프닝 탐색기 — ECO 코드 기반 오프닝 트리.

수순(SAN) 트리를 만들어 다음을 제공한다.
- lookup(moves): 지금까지의 수순에 해당하는 가장 깊은 오프닝 이름/ECO
- continuations(moves): 이 국면에서 이어지는 정석 수들과 그 이름
"""
from __future__ import annotations

from typing import Optional

# (ECO, 한글 이름, 영문 이름, SAN 수순)
OPENINGS: list[tuple[str, str, str, list[str]]] = [
    # --- 1.e4 계열 ---
    ("B00", "킹즈 폰 오프닝", "King's Pawn Opening", ["e4"]),
    ("B00", "님초비치 디펜스", "Nimzowitsch Defense", ["e4", "Nc6"]),
    ("B01", "스칸디나비아 디펜스", "Scandinavian Defense", ["e4", "d5"]),
    ("B02", "알레힌 디펜스", "Alekhine's Defense", ["e4", "Nf6"]),
    ("B06", "모던 디펜스", "Modern Defense", ["e4", "g6"]),
    ("B07", "피르츠 디펜스", "Pirc Defense", ["e4", "d6"]),
    ("B10", "카로칸 디펜스", "Caro-Kann Defense", ["e4", "c6"]),
    ("B12", "카로칸: 어드밴스", "Caro-Kann: Advance", ["e4", "c6", "d4", "d5", "e5"]),
    ("B18", "카로칸: 클래시컬", "Caro-Kann: Classical", ["e4", "c6", "d4", "d5", "Nc3", "dxe4", "Nxe4", "Bf5"]),
    ("B20", "시실리안 디펜스", "Sicilian Defense", ["e4", "c5"]),
    ("B21", "시실리안: 스미스-모라 갬빗", "Sicilian: Smith-Morra Gambit", ["e4", "c5", "d4"]),
    ("B22", "시실리안: 알라핀", "Sicilian: Alapin", ["e4", "c5", "c3"]),
    ("B23", "시실리안: 클로즈드", "Sicilian: Closed", ["e4", "c5", "Nc3"]),
    ("B27", "시실리안: 오픈", "Sicilian: Open", ["e4", "c5", "Nf3"]),
    ("B30", "시실리안: 로소림", "Sicilian: Rossolimo", ["e4", "c5", "Nf3", "Nc6", "Bb5"]),
    ("B33", "시실리안: 스베시니코프", "Sicilian: Sveshnikov", ["e4", "c5", "Nf3", "Nc6", "d4", "cxd4", "Nxd4", "Nf6", "Nc3", "e5"]),
    ("B40", "시실리안: 프렌치 변형", "Sicilian: French Variation", ["e4", "c5", "Nf3", "e6"]),
    ("B50", "시실리안: 나이도르프 전 단계", "Sicilian: Modern", ["e4", "c5", "Nf3", "d6"]),
    ("B54", "시실리안: 오픈, d4", "Sicilian: Open d4", ["e4", "c5", "Nf3", "d6", "d4", "cxd4", "Nxd4"]),
    ("B90", "시실리안: 나이도르프", "Sicilian: Najdorf", ["e4", "c5", "Nf3", "d6", "d4", "cxd4", "Nxd4", "Nf6", "Nc3", "a6"]),
    ("B70", "시실리안: 드래곤", "Sicilian: Dragon", ["e4", "c5", "Nf3", "d6", "d4", "cxd4", "Nxd4", "Nf6", "Nc3", "g6"]),
    ("B80", "시실리안: 셰베닝겐", "Sicilian: Scheveningen", ["e4", "c5", "Nf3", "d6", "d4", "cxd4", "Nxd4", "Nf6", "Nc3", "e6"]),
    ("C00", "프렌치 디펜스", "French Defense", ["e4", "e6"]),
    ("C02", "프렌치: 어드밴스", "French: Advance", ["e4", "e6", "d4", "d5", "e5"]),
    ("C03", "프렌치: 타라시", "French: Tarrasch", ["e4", "e6", "d4", "d5", "Nd2"]),
    ("C10", "프렌치: 폴센", "French: Paulsen", ["e4", "e6", "d4", "d5", "Nc3"]),
    ("C11", "프렌치: 클래시컬", "French: Classical", ["e4", "e6", "d4", "d5", "Nc3", "Nf6"]),
    ("C15", "프렌치: 윈아워", "French: Winawer", ["e4", "e6", "d4", "d5", "Nc3", "Bb4"]),
    ("C20", "킹즈 폰 게임", "King's Pawn Game", ["e4", "e5"]),
    ("C21", "센터 게임", "Center Game", ["e4", "e5", "d4"]),
    ("C23", "비숍 오프닝", "Bishop's Opening", ["e4", "e5", "Bc4"]),
    ("C25", "비엔나 게임", "Vienna Game", ["e4", "e5", "Nc3"]),
    ("C30", "킹즈 갬빗", "King's Gambit", ["e4", "e5", "f4"]),
    ("C33", "킹즈 갬빗 수락", "King's Gambit Accepted", ["e4", "e5", "f4", "exf4"]),
    ("C40", "킹즈 나이트 오프닝", "King's Knight Opening", ["e4", "e5", "Nf3"]),
    ("C41", "필리도르 디펜스", "Philidor Defense", ["e4", "e5", "Nf3", "d6"]),
    ("C42", "페트로프 디펜스", "Petrov's Defense", ["e4", "e5", "Nf3", "Nf6"]),
    ("C44", "킹즈 폰 게임: 오픈", "King's Pawn Game: Open", ["e4", "e5", "Nf3", "Nc6"]),
    ("C44", "스코치 게임", "Scotch Game", ["e4", "e5", "Nf3", "Nc6", "d4"]),
    ("C45", "스코치: 클래시컬", "Scotch: Classical", ["e4", "e5", "Nf3", "Nc6", "d4", "exd4", "Nxd4"]),
    ("C46", "쓰리 나이츠 게임", "Three Knights Game", ["e4", "e5", "Nf3", "Nc6", "Nc3"]),
    ("C47", "포 나이츠 게임", "Four Knights Game", ["e4", "e5", "Nf3", "Nc6", "Nc3", "Nf6"]),
    ("C50", "이탈리안 게임", "Italian Game", ["e4", "e5", "Nf3", "Nc6", "Bc4"]),
    ("C50", "지오코 피아노", "Giuoco Piano", ["e4", "e5", "Nf3", "Nc6", "Bc4", "Bc5"]),
    ("C53", "지오코 피아노: 메인", "Giuoco Piano: Main", ["e4", "e5", "Nf3", "Nc6", "Bc4", "Bc5", "c3"]),
    ("C55", "투 나이츠 디펜스", "Two Knights Defense", ["e4", "e5", "Nf3", "Nc6", "Bc4", "Nf6"]),
    ("C57", "투 나이츠: 프라이드 리버", "Two Knights: Fried Liver", ["e4", "e5", "Nf3", "Nc6", "Bc4", "Nf6", "Ng5", "d5", "exd5", "Nxd5", "Nxf7"]),
    ("C60", "루이 로페즈 (스패니시)", "Ruy Lopez (Spanish)", ["e4", "e5", "Nf3", "Nc6", "Bb5"]),
    ("C63", "루이 로페즈: 슐리만", "Ruy Lopez: Schliemann", ["e4", "e5", "Nf3", "Nc6", "Bb5", "f5"]),
    ("C65", "루이 로페즈: 베를린", "Ruy Lopez: Berlin Defense", ["e4", "e5", "Nf3", "Nc6", "Bb5", "Nf6"]),
    ("C68", "루이 로페즈: 익스체인지", "Ruy Lopez: Exchange", ["e4", "e5", "Nf3", "Nc6", "Bb5", "a6", "Bxc6"]),
    ("C70", "루이 로페즈: 모건", "Ruy Lopez: Morphy Defense", ["e4", "e5", "Nf3", "Nc6", "Bb5", "a6", "Ba4"]),
    ("C84", "루이 로페즈: 클로즈드", "Ruy Lopez: Closed", ["e4", "e5", "Nf3", "Nc6", "Bb5", "a6", "Ba4", "Nf6", "O-O", "Be7"]),

    # --- 1.d4 계열 ---
    ("A40", "퀸즈 폰 오프닝", "Queen's Pawn Opening", ["d4"]),
    ("A45", "인디언 게임", "Indian Game", ["d4", "Nf6"]),
    ("A46", "인디언: 런던 시스템 전개", "Indian: London prep", ["d4", "Nf6", "Nf3"]),
    ("D00", "퀸즈 폰: 클로즈드", "Queen's Pawn: Closed", ["d4", "d5"]),
    ("D02", "런던 시스템", "London System", ["d4", "d5", "Nf3", "Nf6", "Bf4"]),
    ("D06", "퀸즈 갬빗", "Queen's Gambit", ["d4", "d5", "c4"]),
    ("D07", "퀸즈 갬빗: 치고린", "Queen's Gambit: Chigorin", ["d4", "d5", "c4", "Nc6"]),
    ("D10", "슬라브 디펜스", "Slav Defense", ["d4", "d5", "c4", "c6"]),
    ("D20", "퀸즈 갬빗 수락", "Queen's Gambit Accepted", ["d4", "d5", "c4", "dxc4"]),
    ("D30", "퀸즈 갬빗 거절", "Queen's Gambit Declined", ["d4", "d5", "c4", "e6"]),
    ("D35", "QGD: 익스체인지", "QGD: Exchange", ["d4", "d5", "c4", "e6", "Nc3", "Nf6", "cxd5"]),
    ("D43", "세미슬라브 디펜스", "Semi-Slav Defense", ["d4", "d5", "c4", "c6", "Nf3", "Nf6", "Nc3", "e6"]),
    ("E00", "카탈란 오프닝", "Catalan Opening", ["d4", "Nf6", "c4", "e6", "g3"]),
    ("E12", "퀸즈 인디언 디펜스", "Queen's Indian Defense", ["d4", "Nf6", "c4", "e6", "Nf3", "b6"]),
    ("E20", "님초-인디언 디펜스", "Nimzo-Indian Defense", ["d4", "Nf6", "c4", "e6", "Nc3", "Bb4"]),
    ("E60", "킹즈 인디언 디펜스", "King's Indian Defense", ["d4", "Nf6", "c4", "g6"]),
    ("E70", "킹즈 인디언: 메인", "King's Indian: Main", ["d4", "Nf6", "c4", "g6", "Nc3", "Bg7", "e4"]),
    ("E90", "킹즈 인디언: 클래시컬", "King's Indian: Classical", ["d4", "Nf6", "c4", "g6", "Nc3", "Bg7", "e4", "d6", "Nf3", "O-O", "Be2"]),
    ("D80", "그륀펠트 디펜스", "Grünfeld Defense", ["d4", "Nf6", "c4", "g6", "Nc3", "d5"]),
    ("A50", "부다페스트 갬빗", "Budapest Gambit", ["d4", "Nf6", "c4", "e5"]),
    ("A57", "베노니: 벤코 갬빗", "Benko Gambit", ["d4", "Nf6", "c4", "c5", "d5", "b5"]),
    ("A60", "베노니 디펜스", "Benoni Defense", ["d4", "Nf6", "c4", "c5", "d5"]),
    ("A80", "더치 디펜스", "Dutch Defense", ["d4", "f5"]),

    # --- 기타 첫 수 ---
    ("A04", "레티 오프닝", "Réti Opening", ["Nf3"]),
    ("A10", "잉글리시 오프닝", "English Opening", ["c4"]),
    ("A15", "잉글리시: 앵글로-인디언", "English: Anglo-Indian", ["c4", "Nf6"]),
    ("A20", "잉글리시: 리버스 시실리안", "English: Reversed Sicilian", ["c4", "e5"]),
    ("A00", "버드 오프닝", "Bird's Opening", ["f4"]),
    ("B00", "오웬 디펜스", "Owen's Defense", ["e4", "b6"]),
    ("A00", "소콜스키 (폴리시)", "Sokolsky (Polish)", ["b4"]),
    ("A00", "그롭 어택", "Grob Attack", ["g4"]),
]

# 수순 트리: key = tuple(SAN moves), value = {"eco","ko","en"}
_INDEX: dict[tuple, dict] = {}
# 부모 → 자식 수 목록
_CHILDREN: dict[tuple, set] = {}


def _build() -> None:
    _INDEX.clear()
    _CHILDREN.clear()
    for eco, ko, en, moves in OPENINGS:
        key = tuple(moves)
        _INDEX[key] = {"eco": eco, "ko": ko, "en": en, "moves": list(moves)}
        # 모든 접두사에 대해 자식 등록
        for i in range(len(moves)):
            parent = tuple(moves[:i])
            _CHILDREN.setdefault(parent, set()).add(moves[i])


_build()


def lookup(moves: list[str]) -> Optional[dict]:
    """가장 깊게 일치하는 오프닝(부분 접두사 포함)을 반환."""
    best = None
    for i in range(len(moves), -1, -1):
        key = tuple(moves[:i])
        if key in _INDEX:
            best = dict(_INDEX[key])
            best["depth"] = i
            return best
    return best


def continuations(moves: list[str]) -> list[dict]:
    """이 수순 다음에 둘 수 있는 정석 수들."""
    parent = tuple(moves)
    out = []
    for san in sorted(_CHILDREN.get(parent, set())):
        child_key = parent + (san,)
        info = _INDEX.get(child_key)
        # 이름이 붙지 않은 중간 수라면 더 깊은 곳의 대표 이름을 찾아 준다
        if not info:
            deeper = [v for k, v in _INDEX.items()
                      if len(k) > len(child_key) and k[:len(child_key)] == child_key]
            info = deeper[0] if deeper else None
        out.append({
            "san": san,
            "eco": info["eco"] if info else "",
            "name": info["en"] if info else "",   # 표시는 영문 정식 명칭
            "nameKo": info["ko"] if info else "",
        })
    return out


def count() -> int:
    return len(OPENINGS)


def search(query: str, limit: int = 20) -> list[dict]:
    """이름으로 오프닝 검색."""
    q = (query or "").strip().lower()
    if not q:
        return []
    out = []
    for eco, ko, en, moves in OPENINGS:
        if q in ko.lower() or q in en.lower() or q == eco.lower():
            out.append({"eco": eco, "ko": ko, "en": en, "moves": moves})
        if len(out) >= limit:
            break
    return out
