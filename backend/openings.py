"""오프닝 탐색기 — ECO 코드 기반 오프닝 트리.

수순(SAN) 트리를 만들어 다음을 제공한다.
- lookup(moves): 지금까지의 수순에 해당하는 가장 깊은 오프닝 이름/ECO
- continuations(moves): 이 국면에서 이어지는 정석 수들과 그 이름
"""
from __future__ import annotations

from typing import Optional

# (ECO, 한글 이름, 영문 이름, SAN 수순)
OPENINGS: list[tuple[str, str, str, list[str]]] = [
    ("B00", "킹즈 폰 오프닝", "King's Pawn Opening", ["e4"]),
    ("B00", "님초비치 디펜스", "Nimzowitsch Defense", ["e4", "Nc6"]),
    ("B00", "오웬 디펜스", "Owen's Defense", ["e4", "b6"]),
    ("B00", "세인트 조지 디펜스", "St. George Defense", ["e4", "a6"]),
    ("B01", "스칸디나비아 디펜스", "Scandinavian Defense", ["e4", "d5"]),
    ("B01", "스칸디나비아: 메인 라인", "Scandinavian: Main Line", ["e4", "d5", "exd5", "Qxd5", "Nc3", "Qa5"]),
    ("B01", "스칸디나비아: 모던", "Scandinavian: Modern", ["e4", "d5", "exd5", "Nf6"]),
    ("B02", "알레힌 디펜스", "Alekhine's Defense", ["e4", "Nf6"]),
    ("B03", "알레힌: 포 폰즈", "Alekhine: Four Pawns Attack", ["e4", "Nf6", "e5", "Nd5", "d4", "d6", "c4", "Nb6", "f4"]),
    ("B04", "알레힌: 모던", "Alekhine: Modern", ["e4", "Nf6", "e5", "Nd5", "d4", "d6", "Nf3"]),
    ("B06", "모던 디펜스", "Modern Defense", ["e4", "g6"]),
    ("B07", "피르츠 디펜스", "Pirc Defense", ["e4", "d6", "d4", "Nf6", "Nc3", "g6"]),
    ("B08", "피르츠: 클래시컬", "Pirc: Classical", ["e4", "d6", "d4", "Nf6", "Nc3", "g6", "Nf3", "Bg7"]),
    ("B09", "피르츠: 오스트리안 어택", "Pirc: Austrian Attack", ["e4", "d6", "d4", "Nf6", "Nc3", "g6", "f4"]),
    ("B10", "카로칸 디펜스", "Caro-Kann Defense", ["e4", "c6"]),
    ("B12", "카로칸: 어드밴스", "Caro-Kann: Advance", ["e4", "c6", "d4", "d5", "e5"]),
    ("B13", "카로칸: 익스체인지", "Caro-Kann: Exchange", ["e4", "c6", "d4", "d5", "exd5", "cxd5"]),
    ("B14", "카로칸: 파노프-보트비닉", "Caro-Kann: Panov-Botvinnik", ["e4", "c6", "d4", "d5", "exd5", "cxd5", "c4"]),
    ("B15", "카로칸: 메인", "Caro-Kann: Main Line", ["e4", "c6", "d4", "d5", "Nc3"]),
    ("B18", "카로칸: 클래시컬", "Caro-Kann: Classical", ["e4", "c6", "d4", "d5", "Nc3", "dxe4", "Nxe4", "Bf5"]),
    ("B19", "카로칸: 클래시컬, 메인", "Caro-Kann: Classical Main", ["e4", "c6", "d4", "d5", "Nc3", "dxe4", "Nxe4", "Bf5", "Ng3", "Bg6", "h4", "h6", "Nf3", "Nd7"]),
    ("B20", "시실리안 디펜스", "Sicilian Defense", ["e4", "c5"]),
    ("B21", "시실리안: 스미스-모라 갬빗", "Sicilian: Smith-Morra Gambit", ["e4", "c5", "d4", "cxd4", "c3"]),
    ("B21", "시실리안: 그랑프리 어택", "Sicilian: Grand Prix Attack", ["e4", "c5", "Nc3", "Nc6", "f4"]),
    ("B22", "시실리안: 알라핀", "Sicilian: Alapin", ["e4", "c5", "c3"]),
    ("B23", "시실리안: 클로즈드", "Sicilian: Closed", ["e4", "c5", "Nc3"]),
    ("B27", "시실리안: 오픈", "Sicilian: Open", ["e4", "c5", "Nf3"]),
    ("B30", "시실리안: 로소림", "Sicilian: Rossolimo", ["e4", "c5", "Nf3", "Nc6", "Bb5"]),
    ("B31", "시실리안: 로소림, 모스크바", "Sicilian: Moscow", ["e4", "c5", "Nf3", "d6", "Bb5+"]),
    ("B32", "시실리안: 라스커-펠리칸", "Sicilian: Lasker-Pelikan", ["e4", "c5", "Nf3", "Nc6", "d4", "cxd4", "Nxd4", "Nf6", "Nc3", "e5"]),
    ("B33", "시실리안: 스베시니코프", "Sicilian: Sveshnikov", ["e4", "c5", "Nf3", "Nc6", "d4", "cxd4", "Nxd4", "Nf6", "Nc3", "e5", "Ndb5", "d6"]),
    ("B40", "시실리안: 프렌치 변형", "Sicilian: French Variation", ["e4", "c5", "Nf3", "e6"]),
    ("B44", "시실리안: 타이마노프", "Sicilian: Taimanov", ["e4", "c5", "Nf3", "e6", "d4", "cxd4", "Nxd4", "Nc6"]),
    ("B47", "시실리안: 타이마노프, 메인", "Sicilian: Taimanov Main", ["e4", "c5", "Nf3", "e6", "d4", "cxd4", "Nxd4", "Nc6", "Nc3", "Qc7"]),
    ("B50", "시실리안: 모던", "Sicilian: Modern", ["e4", "c5", "Nf3", "d6"]),
    ("B54", "시실리안: 오픈 d4", "Sicilian: Open d4", ["e4", "c5", "Nf3", "d6", "d4", "cxd4", "Nxd4"]),
    ("B70", "시실리안: 드래곤", "Sicilian: Dragon", ["e4", "c5", "Nf3", "d6", "d4", "cxd4", "Nxd4", "Nf6", "Nc3", "g6"]),
    ("B76", "시실리안: 드래곤, 유고슬라브", "Sicilian: Dragon, Yugoslav Attack", ["e4", "c5", "Nf3", "d6", "d4", "cxd4", "Nxd4", "Nf6", "Nc3", "g6", "Be3", "Bg7", "f3", "O-O", "Qd2", "Nc6"]),
    ("B80", "시실리안: 셰베닝겐", "Sicilian: Scheveningen", ["e4", "c5", "Nf3", "d6", "d4", "cxd4", "Nxd4", "Nf6", "Nc3", "e6"]),
    ("B90", "시실리안: 나이도르프", "Sicilian: Najdorf", ["e4", "c5", "Nf3", "d6", "d4", "cxd4", "Nxd4", "Nf6", "Nc3", "a6"]),
    ("B92", "시실리안: 나이도르프, Be2", "Sicilian: Najdorf, Opocensky", ["e4", "c5", "Nf3", "d6", "d4", "cxd4", "Nxd4", "Nf6", "Nc3", "a6", "Be2"]),
    ("B96", "시실리안: 나이도르프, Bg5", "Sicilian: Najdorf, Main Line", ["e4", "c5", "Nf3", "d6", "d4", "cxd4", "Nxd4", "Nf6", "Nc3", "a6", "Bg5"]),
    ("B22", "시실리안: 알라핀, d5", "Sicilian: Alapin, d5", ["e4", "c5", "c3", "d5", "exd5", "Qxd5"]),
    ("C00", "프렌치 디펜스", "French Defense", ["e4", "e6"]),
    ("C01", "프렌치: 익스체인지", "French: Exchange", ["e4", "e6", "d4", "d5", "exd5", "exd5"]),
    ("C02", "프렌치: 어드밴스", "French: Advance", ["e4", "e6", "d4", "d5", "e5"]),
    ("C03", "프렌치: 타라시", "French: Tarrasch", ["e4", "e6", "d4", "d5", "Nd2"]),
    ("C10", "프렌치: 폴센", "French: Paulsen", ["e4", "e6", "d4", "d5", "Nc3"]),
    ("C11", "프렌치: 클래시컬", "French: Classical", ["e4", "e6", "d4", "d5", "Nc3", "Nf6"]),
    ("C15", "프렌치: 윈아워", "French: Winawer", ["e4", "e6", "d4", "d5", "Nc3", "Bb4"]),
    ("C18", "프렌치: 윈아워, 메인", "French: Winawer Main", ["e4", "e6", "d4", "d5", "Nc3", "Bb4", "e5", "c5", "a3", "Bxc3+", "bxc3"]),
    ("C20", "킹즈 폰 게임", "King's Pawn Game", ["e4", "e5"]),
    ("C21", "센터 게임", "Center Game", ["e4", "e5", "d4"]),
    ("C22", "센터 게임: 메인", "Center Game: Main", ["e4", "e5", "d4", "exd4", "Qxd4", "Nc6"]),
    ("C23", "비숍 오프닝", "Bishop's Opening", ["e4", "e5", "Bc4"]),
    ("C25", "비엔나 게임", "Vienna Game", ["e4", "e5", "Nc3"]),
    ("C27", "비엔나: 프랑켄슈타인-드라큘라", "Vienna: Frankenstein-Dracula", ["e4", "e5", "Nc3", "Nf6", "Bc4", "Nxe4"]),
    ("C30", "킹즈 갬빗", "King's Gambit", ["e4", "e5", "f4"]),
    ("C33", "킹즈 갬빗 수락", "King's Gambit Accepted", ["e4", "e5", "f4", "exf4"]),
    ("C34", "킹즈 갬빗: 나이트", "King's Gambit: Knight's Gambit", ["e4", "e5", "f4", "exf4", "Nf3"]),
    ("C36", "킹즈 갬빗: 모던 디펜스", "King's Gambit: Modern Defense", ["e4", "e5", "f4", "exf4", "Nf3", "d5"]),
    ("C30", "킹즈 갬빗 거절", "King's Gambit Declined", ["e4", "e5", "f4", "Bc5"]),
    ("C40", "킹즈 나이트 오프닝", "King's Knight Opening", ["e4", "e5", "Nf3"]),
    ("C40", "라트비안 갬빗", "Latvian Gambit", ["e4", "e5", "Nf3", "f5"]),
    ("C41", "필리도르 디펜스", "Philidor Defense", ["e4", "e5", "Nf3", "d6"]),
    ("C42", "페트로프 디펜스", "Petrov's Defense", ["e4", "e5", "Nf3", "Nf6"]),
    ("C43", "페트로프: 스타이니츠", "Petrov: Steinitz", ["e4", "e5", "Nf3", "Nf6", "d4"]),
    ("C44", "킹즈 폰 게임: 오픈", "King's Pawn Game: Open", ["e4", "e5", "Nf3", "Nc6"]),
    ("C44", "스코치 게임", "Scotch Game", ["e4", "e5", "Nf3", "Nc6", "d4"]),
    ("C44", "폰지아니 오프닝", "Ponziani Opening", ["e4", "e5", "Nf3", "Nc6", "c3"]),
    ("C45", "스코치: 클래시컬", "Scotch: Classical", ["e4", "e5", "Nf3", "Nc6", "d4", "exd4", "Nxd4"]),
    ("C45", "스코치: 미제스", "Scotch: Mieses", ["e4", "e5", "Nf3", "Nc6", "d4", "exd4", "Nxd4", "Nf6", "Nxc6", "bxc6", "e5"]),
    ("C46", "쓰리 나이츠 게임", "Three Knights Game", ["e4", "e5", "Nf3", "Nc6", "Nc3"]),
    ("C47", "포 나이츠 게임", "Four Knights Game", ["e4", "e5", "Nf3", "Nc6", "Nc3", "Nf6"]),
    ("C48", "포 나이츠: 스패니시", "Four Knights: Spanish", ["e4", "e5", "Nf3", "Nc6", "Nc3", "Nf6", "Bb5"]),
    ("C49", "포 나이츠: 더블 루이", "Four Knights: Double Ruy Lopez", ["e4", "e5", "Nf3", "Nc6", "Nc3", "Nf6", "Bb5", "Bb4"]),
    ("C50", "이탈리안 게임", "Italian Game", ["e4", "e5", "Nf3", "Nc6", "Bc4"]),
    ("C50", "지오코 피아노", "Giuoco Piano", ["e4", "e5", "Nf3", "Nc6", "Bc4", "Bc5"]),
    ("C50", "헝가리안 디펜스", "Hungarian Defense", ["e4", "e5", "Nf3", "Nc6", "Bc4", "Be7"]),
    ("C51", "에반스 갬빗", "Evans Gambit", ["e4", "e5", "Nf3", "Nc6", "Bc4", "Bc5", "b4"]),
    ("C53", "지오코 피아노: 메인", "Giuoco Piano: Main", ["e4", "e5", "Nf3", "Nc6", "Bc4", "Bc5", "c3"]),
    ("C54", "지오코 피아노: 그레코", "Giuoco Piano: Greco", ["e4", "e5", "Nf3", "Nc6", "Bc4", "Bc5", "c3", "Nf6", "d4", "exd4", "cxd4", "Bb4+"]),
    ("C55", "투 나이츠 디펜스", "Two Knights Defense", ["e4", "e5", "Nf3", "Nc6", "Bc4", "Nf6"]),
    ("C56", "투 나이츠: 메인", "Two Knights: Main", ["e4", "e5", "Nf3", "Nc6", "Bc4", "Nf6", "d4", "exd4", "O-O"]),
    ("C57", "투 나이츠: 프라이드 리버", "Two Knights: Fried Liver Attack", ["e4", "e5", "Nf3", "Nc6", "Bc4", "Nf6", "Ng5", "d5", "exd5", "Nxd5", "Nxf7"]),
    ("C57", "투 나이츠: 트랙슬러", "Two Knights: Traxler", ["e4", "e5", "Nf3", "Nc6", "Bc4", "Nf6", "Ng5", "Bc5"]),
    ("C58", "투 나이츠: 폴케비어", "Two Knights: Polerio", ["e4", "e5", "Nf3", "Nc6", "Bc4", "Nf6", "Ng5", "d5", "exd5", "Na5"]),
    ("C60", "루이 로페즈 (스패니시)", "Ruy Lopez (Spanish)", ["e4", "e5", "Nf3", "Nc6", "Bb5"]),
    ("C60", "루이 로페즈: 코지오", "Ruy Lopez: Cozio", ["e4", "e5", "Nf3", "Nc6", "Bb5", "Nge7"]),
    ("C61", "루이 로페즈: 버드", "Ruy Lopez: Bird's Defense", ["e4", "e5", "Nf3", "Nc6", "Bb5", "Nd4"]),
    ("C62", "루이 로페즈: 올드 스타이니츠", "Ruy Lopez: Old Steinitz", ["e4", "e5", "Nf3", "Nc6", "Bb5", "d6"]),
    ("C63", "루이 로페즈: 슐리만", "Ruy Lopez: Schliemann", ["e4", "e5", "Nf3", "Nc6", "Bb5", "f5"]),
    ("C64", "루이 로페즈: 클래시컬", "Ruy Lopez: Classical", ["e4", "e5", "Nf3", "Nc6", "Bb5", "Bc5"]),
    ("C65", "루이 로페즈: 베를린", "Ruy Lopez: Berlin Defense", ["e4", "e5", "Nf3", "Nc6", "Bb5", "Nf6"]),
    ("C67", "루이 로페즈: 베를린, 메인", "Ruy Lopez: Berlin, Open", ["e4", "e5", "Nf3", "Nc6", "Bb5", "Nf6", "O-O", "Nxe4"]),
    ("C68", "루이 로페즈: 익스체인지", "Ruy Lopez: Exchange", ["e4", "e5", "Nf3", "Nc6", "Bb5", "a6", "Bxc6", "dxc6"]),
    ("C70", "루이 로페즈: 모건", "Ruy Lopez: Morphy Defense", ["e4", "e5", "Nf3", "Nc6", "Bb5", "a6", "Ba4"]),
    ("C77", "루이 로페즈: 안더센", "Ruy Lopez: Anderssen", ["e4", "e5", "Nf3", "Nc6", "Bb5", "a6", "Ba4", "Nf6", "d3"]),
    ("C78", "루이 로페즈: 아르한겔스크", "Ruy Lopez: Archangelsk", ["e4", "e5", "Nf3", "Nc6", "Bb5", "a6", "Ba4", "Nf6", "O-O", "b5", "Bb3", "Bb7"]),
    ("C80", "루이 로페즈: 오픈", "Ruy Lopez: Open", ["e4", "e5", "Nf3", "Nc6", "Bb5", "a6", "Ba4", "Nf6", "O-O", "Nxe4"]),
    ("C84", "루이 로페즈: 클로즈드", "Ruy Lopez: Closed", ["e4", "e5", "Nf3", "Nc6", "Bb5", "a6", "Ba4", "Nf6", "O-O", "Be7"]),
    ("C88", "루이 로페즈: 클로즈드, 메인", "Ruy Lopez: Closed Main", ["e4", "e5", "Nf3", "Nc6", "Bb5", "a6", "Ba4", "Nf6", "O-O", "Be7", "Re1", "b5", "Bb3"]),
    ("C89", "루이 로페즈: 마샬 어택", "Ruy Lopez: Marshall Attack", ["e4", "e5", "Nf3", "Nc6", "Bb5", "a6", "Ba4", "Nf6", "O-O", "Be7", "Re1", "b5", "Bb3", "O-O", "c3", "d5"]),
    ("A40", "퀸즈 폰 오프닝", "Queen's Pawn Opening", ["d4"]),
    ("A40", "잉글런드 갬빗", "Englund Gambit", ["d4", "e5"]),
    ("A41", "모던 디펜스 (d4)", "Modern Defense (d4)", ["d4", "d6"]),
    ("A43", "올드 베노니", "Old Benoni", ["d4", "c5"]),
    ("A45", "인디언 게임", "Indian Game", ["d4", "Nf6"]),
    ("A45", "트롬포프스키 어택", "Trompowsky Attack", ["d4", "Nf6", "Bg5"]),
    ("A46", "인디언: 나이트 전개", "Indian: Knight Variation", ["d4", "Nf6", "Nf3"]),
    ("A48", "런던 시스템 (인디언)", "London System (Indian)", ["d4", "Nf6", "Nf3", "g6", "Bf4"]),
    ("A50", "부다페스트 갬빗", "Budapest Gambit", ["d4", "Nf6", "c4", "e5"]),
    ("A53", "올드 인디언 디펜스", "Old Indian Defense", ["d4", "Nf6", "c4", "d6"]),
    ("A56", "베노니 디펜스", "Benoni Defense", ["d4", "Nf6", "c4", "c5"]),
    ("A57", "벤코 갬빗", "Benko Gambit", ["d4", "Nf6", "c4", "c5", "d5", "b5"]),
    ("A60", "모던 베노니", "Modern Benoni", ["d4", "Nf6", "c4", "c5", "d5", "e6"]),
    ("A80", "더치 디펜스", "Dutch Defense", ["d4", "f5"]),
    ("A87", "더치: 레닌그라드", "Dutch: Leningrad", ["d4", "f5", "g3", "Nf6", "Bg2", "g6", "Nf3", "Bg7", "O-O", "O-O", "c4"]),
    ("A90", "더치: 스톤월", "Dutch: Stonewall", ["d4", "f5", "g3", "Nf6", "Bg2", "e6", "Nf3", "d5"]),
    ("D00", "퀸즈 폰: 클로즈드", "Queen's Pawn: Closed", ["d4", "d5"]),
    ("D00", "런던 시스템", "London System", ["d4", "d5", "Nf3", "Nf6", "Bf4"]),
    ("D00", "콜 시스템", "Colle System", ["d4", "d5", "Nf3", "Nf6", "e3"]),
    ("D01", "리처-베슬리 어택", "Richter-Veresov Attack", ["d4", "d5", "Nc3", "Nf6", "Bg5"]),
    ("D02", "퀸즈 폰: 심메트리", "Queen's Pawn: Symmetrical", ["d4", "d5", "Nf3"]),
    ("D06", "퀸즈 갬빗", "Queen's Gambit", ["d4", "d5", "c4"]),
    ("D07", "퀸즈 갬빗: 치고린", "Queen's Gambit: Chigorin", ["d4", "d5", "c4", "Nc6"]),
    ("D08", "퀸즈 갬빗: 알빈 카운터갬빗", "Queen's Gambit: Albin Countergambit", ["d4", "d5", "c4", "e5"]),
    ("D10", "슬라브 디펜스", "Slav Defense", ["d4", "d5", "c4", "c6"]),
    ("D15", "슬라브: 메인", "Slav: Main Line", ["d4", "d5", "c4", "c6", "Nf3", "Nf6", "Nc3", "dxc4"]),
    ("D20", "퀸즈 갬빗 수락", "Queen's Gambit Accepted", ["d4", "d5", "c4", "dxc4"]),
    ("D30", "퀸즈 갬빗 거절", "Queen's Gambit Declined", ["d4", "d5", "c4", "e6"]),
    ("D31", "QGD: 세미슬라브 전개", "QGD: Semi-Slav prep", ["d4", "d5", "c4", "e6", "Nc3", "c6"]),
    ("D32", "타라시 디펜스", "Tarrasch Defense", ["d4", "d5", "c4", "e6", "Nc3", "c5"]),
    ("D35", "QGD: 익스체인지", "QGD: Exchange", ["d4", "d5", "c4", "e6", "Nc3", "Nf6", "cxd5", "exd5"]),
    ("D37", "QGD: 클래시컬", "QGD: Classical", ["d4", "d5", "c4", "e6", "Nc3", "Nf6", "Nf3", "Be7"]),
    ("D43", "세미슬라브 디펜스", "Semi-Slav Defense", ["d4", "d5", "c4", "c6", "Nf3", "Nf6", "Nc3", "e6"]),
    ("D44", "세미슬라브: 보트비닉", "Semi-Slav: Botvinnik", ["d4", "d5", "c4", "c6", "Nf3", "Nf6", "Nc3", "e6", "Bg5", "dxc4", "e4", "b5"]),
    ("D45", "세미슬라브: 메인", "Semi-Slav: Main", ["d4", "d5", "c4", "c6", "Nf3", "Nf6", "Nc3", "e6", "e3"]),
    ("E00", "카탈란 오프닝", "Catalan Opening", ["d4", "Nf6", "c4", "e6", "g3"]),
    ("E04", "카탈란: 오픈", "Catalan: Open", ["d4", "Nf6", "c4", "e6", "g3", "d5", "Bg2", "dxc4"]),
    ("E06", "카탈란: 클로즈드", "Catalan: Closed", ["d4", "Nf6", "c4", "e6", "g3", "d5", "Bg2", "Be7"]),
    ("E10", "인디언: 블루멘펠트 전개", "Indian: Blumenfeld prep", ["d4", "Nf6", "c4", "e6", "Nf3"]),
    ("E12", "퀸즈 인디언 디펜스", "Queen's Indian Defense", ["d4", "Nf6", "c4", "e6", "Nf3", "b6"]),
    ("E15", "퀸즈 인디언: 메인", "Queen's Indian: Main", ["d4", "Nf6", "c4", "e6", "Nf3", "b6", "g3"]),
    ("E20", "님초-인디언 디펜스", "Nimzo-Indian Defense", ["d4", "Nf6", "c4", "e6", "Nc3", "Bb4"]),
    ("E21", "님초-인디언: 쓰리 나이츠", "Nimzo-Indian: Three Knights", ["d4", "Nf6", "c4", "e6", "Nc3", "Bb4", "Nf3"]),
    ("E32", "님초-인디언: 클래시컬", "Nimzo-Indian: Classical", ["d4", "Nf6", "c4", "e6", "Nc3", "Bb4", "Qc2"]),
    ("E40", "님초-인디언: 루빈스타인", "Nimzo-Indian: Rubinstein", ["d4", "Nf6", "c4", "e6", "Nc3", "Bb4", "e3"]),
    ("E60", "킹즈 인디언 디펜스", "King's Indian Defense", ["d4", "Nf6", "c4", "g6"]),
    ("E61", "킹즈 인디언: 스미슬로프", "King's Indian: Smyslov", ["d4", "Nf6", "c4", "g6", "Nc3", "Bg7", "Nf3", "d6", "Bg5"]),
    ("E70", "킹즈 인디언: 메인", "King's Indian: Main", ["d4", "Nf6", "c4", "g6", "Nc3", "Bg7", "e4"]),
    ("E76", "킹즈 인디언: 포 폰즈", "King's Indian: Four Pawns", ["d4", "Nf6", "c4", "g6", "Nc3", "Bg7", "e4", "d6", "f4"]),
    ("E80", "킹즈 인디언: 죔쉬", "King's Indian: Sämisch", ["d4", "Nf6", "c4", "g6", "Nc3", "Bg7", "e4", "d6", "f3"]),
    ("E90", "킹즈 인디언: 클래시컬", "King's Indian: Classical", ["d4", "Nf6", "c4", "g6", "Nc3", "Bg7", "e4", "d6", "Nf3", "O-O", "Be2"]),
    ("E97", "킹즈 인디언: 마샬", "King's Indian: Mar del Plata", ["d4", "Nf6", "c4", "g6", "Nc3", "Bg7", "e4", "d6", "Nf3", "O-O", "Be2", "e5", "O-O", "Nc6", "d5", "Ne7"]),
    ("D70", "그륀펠트 디펜스", "Grünfeld Defense", ["d4", "Nf6", "c4", "g6", "Nc3", "d5"]),
    ("D85", "그륀펠트: 익스체인지", "Grünfeld: Exchange", ["d4", "Nf6", "c4", "g6", "Nc3", "d5", "cxd5", "Nxd5", "e4", "Nxc3", "bxc3"]),
    ("D94", "그륀펠트: 클로즈드", "Grünfeld: Closed", ["d4", "Nf6", "c4", "g6", "Nc3", "d5", "Nf3", "Bg7", "e3"]),
    ("A04", "레티 오프닝", "Réti Opening", ["Nf3"]),
    ("A05", "레티: 킹즈 인디언 어택", "Réti: King's Indian Attack", ["Nf3", "Nf6", "g3"]),
    ("A07", "킹즈 인디언 어택", "King's Indian Attack", ["Nf3", "d5", "g3"]),
    ("A10", "잉글리시 오프닝", "English Opening", ["c4"]),
    ("A15", "잉글리시: 앵글로-인디언", "English: Anglo-Indian", ["c4", "Nf6"]),
    ("A20", "잉글리시: 리버스 시실리안", "English: Reversed Sicilian", ["c4", "e5"]),
    ("A25", "잉글리시: 클로즈드", "English: Closed", ["c4", "e5", "Nc3", "Nc6"]),
    ("A30", "잉글리시: 심메트리", "English: Symmetrical", ["c4", "c5"]),
    ("A34", "잉글리시: 심메트리, 쓰리 나이츠", "English: Symmetrical, Three Knights", ["c4", "c5", "Nc3", "Nf6", "g3"]),
    ("A00", "버드 오프닝", "Bird's Opening", ["f4"]),
    ("A02", "버드: 프롬 갬빗", "Bird: From's Gambit", ["f4", "e5"]),
    ("A00", "소콜스키 (폴리시)", "Sokolsky (Polish)", ["b4"]),
    ("A00", "그롭 어택", "Grob Attack", ["g4"]),
    ("A00", "라르센 어택", "Larsen's Opening", ["b3"]),
    ("A00", "반 게트 오프닝", "Van't Kruijs Opening", ["e3"]),
    ("A00", "안더센 오프닝", "Anderssen's Opening", ["a3"]),
    ("A00", "듀나스트 오프닝", "Durkin Opening", ["Na3"]),
    ("B00", "포트나이트 (Nc3)", "Van Geet Opening", ["Nc3"]),
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


def search(query: str, limit: int = 40) -> list[dict]:
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
