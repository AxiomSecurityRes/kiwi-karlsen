"""Glicko-2 레이팅 시스템 구현 (Mark Glickman 알고리즘).

Chess.com / Lichess 류의 레이팅 변동 로직을 백엔드에서 처리한다.
"""
import math

TAU = 0.5          # 시스템 변동성 제약 상수
EPSILON = 1e-6
SCALE = 173.7178   # Glicko-2 내부 스케일
DEFAULT_RATING = 1500.0
DEFAULT_RD = 350.0
DEFAULT_VOL = 0.06


def _g(phi: float) -> float:
    return 1.0 / math.sqrt(1.0 + 3.0 * phi * phi / (math.pi * math.pi))


def _expected(mu: float, mu_j: float, phi_j: float) -> float:
    return 1.0 / (1.0 + math.exp(-_g(phi_j) * (mu - mu_j)))


def rate(rating: float, rd: float, vol: float, results: list[tuple[float, float, float]]):
    """한 플레이어의 새 (rating, rd, vol) 계산.

    results: [(상대레이팅, 상대RD, 점수), ...]  점수: 승 1.0 / 무 0.5 / 패 0.0
    """
    mu = (rating - DEFAULT_RATING) / SCALE
    phi = rd / SCALE
    sigma = vol

    if not results:
        # 미대국 기간: RD 만 증가
        phi_star = math.sqrt(phi * phi + sigma * sigma)
        new_rd = min(phi_star * SCALE, DEFAULT_RD)
        return rating, new_rd, sigma

    # 분산(v) 과 델타(Δ) 계산
    v_inv = 0.0
    delta_sum = 0.0
    for opp_r, opp_rd, score in results:
        mu_j = (opp_r - DEFAULT_RATING) / SCALE
        phi_j = opp_rd / SCALE
        g_j = _g(phi_j)
        e_j = _expected(mu, mu_j, phi_j)
        v_inv += g_j * g_j * e_j * (1.0 - e_j)
        delta_sum += g_j * (score - e_j)

    v = 1.0 / v_inv
    delta = v * delta_sum

    # 새 변동성(sigma') 을 일루미네이션(반복법)으로 구함
    a = math.log(sigma * sigma)

    def f(x: float) -> float:
        ex = math.exp(x)
        num = ex * (delta * delta - phi * phi - v - ex)
        den = 2.0 * (phi * phi + v + ex) ** 2
        return (num / den) - (x - a) / (TAU * TAU)

    A = a
    if delta * delta > phi * phi + v:
        B = math.log(delta * delta - phi * phi - v)
    else:
        k = 1
        while f(a - k * TAU) < 0:
            k += 1
        B = a - k * TAU

    f_a = f(A)
    f_b = f(B)
    while abs(B - A) > EPSILON:
        C = A + (A - B) * f_a / (f_b - f_a)
        f_c = f(C)
        if f_c * f_b <= 0:
            A, f_a = B, f_b
        else:
            f_a = f_a / 2.0
        B, f_b = C, f_c

    new_sigma = math.exp(A / 2.0)

    # RD, rating 갱신
    phi_star = math.sqrt(phi * phi + new_sigma * new_sigma)
    new_phi = 1.0 / math.sqrt(1.0 / (phi_star * phi_star) + 1.0 / v)
    new_mu = mu + new_phi * new_phi * delta_sum

    new_rating = SCALE * new_mu + DEFAULT_RATING
    new_rd = SCALE * new_phi
    new_rd = max(30.0, min(new_rd, DEFAULT_RD))
    return new_rating, new_rd, new_sigma


def update_pair(white, black, white_score: float):
    """온라인 대국 종료 후 두 플레이어를 동시에 갱신.

    white, black: User ORM (rating, rd, vol 속성 사용)
    white_score: 백이 본 점수 (승 1.0 / 무 0.5 / 패 0.0)
    반환: (white_delta, black_delta)
    """
    black_score = 1.0 - white_score

    # 갱신 전 상대 값을 고정해서 사용
    w_r, w_rd, w_vol = white.rating, white.rd, white.vol
    b_r, b_rd, b_vol = black.rating, black.rd, black.vol

    nw_r, nw_rd, nw_vol = rate(w_r, w_rd, w_vol, [(b_r, b_rd, white_score)])
    nb_r, nb_rd, nb_vol = rate(b_r, b_rd, b_vol, [(w_r, w_rd, black_score)])

    white_delta = nw_r - w_r
    black_delta = nb_r - b_r

    white.rating, white.rd, white.vol = nw_r, nw_rd, nw_vol
    black.rating, black.rd, black.vol = nb_r, nb_rd, nb_vol
    return white_delta, black_delta
