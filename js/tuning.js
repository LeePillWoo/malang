// 손으로 맞춘 접촉점(프레임 안 좌표, 시트 픽셀). tools/prepare.cjs 자동 측정값을 덮어쓴다.
// 그림에 묶인 값이라 리소스 폴더별로 둔다: MP_TUNING[리소스 폴더][동물][행동 ID][프레임 번호] = { … }
//   hug   = 공·인형을 안는 자리(ball_hug, toy_nap)   mouth = 무는 자리(toy_bite, tug)
//   reach = 앞발 끝(ball_push 접촉)                pivot = 바닥 기준점(자동이 틀린 프레임만)
// 확인: tools/qa_frames.html?ch=동물&a=ball_hug,toy_nap (보라 점 = hug)
//
// v2 는 점프 높이가 칸 안에 그려져 있다. 게임이 포물선으로 직접 띄우므로 공중 3프레임(2·3·4)은
// 그림 속 발바닥 높이를 기준점으로 준다(값 = data/metrics.js 의 jump ground.y, x 는 칸 중심 128).
window.MP_TUNING = (() => {
  const jumpAir = (y2, y3, y4) => ({ 2: { pivot: [128, y2] }, 3: { pivot: [128, y3] }, 4: { pivot: [128, y4] } });
  return {
    desktop_pet_assets_v2: {
      cat: {
        jump: jumpAir(204, 193, 206),
        ball_hug: { 3: { hug: [120, 152] }, 4: { hug: [145, 150] }, 5: { hug: [138, 180] } },
        toy_nap: { 2: { hug: [138, 208] }, 3: { hug: [138, 210] }, 4: { hug: [160, 210] }, 5: { hug: [128, 212] } },
      },
      dog: { jump: jumpAir(204, 193, 206) },
      chick: { jump: jumpAir(204, 194, 206) },
      bear: { jump: jumpAir(204, 194, 205) },
      rabbit: { jump: jumpAir(204, 194, 206) },
    },
  };
})();
