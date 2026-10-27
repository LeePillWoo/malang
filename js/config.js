// 게임 설정. 위치·크기·속도처럼 손으로 맞추는 숫자는 여기에만 둔다.
// 좌표 단위 = 방 배경 그림 픽셀(1536×1024). y 는 바닥에 닿는 점(깊이), z 는 바닥에서 뜬 높이.
// assetBase 를 바꾸면 node tools/prepare.cjs 를 다시 실행한다.
window.MP_CONFIG = {
  assetBase: 'desktop_pet_assets_v2/',   // 리소스 폴더(manifest.json 이 있는 곳). 2026-10-26 부터 v2 가 기준
  character: 'cat',                      // 처음 고르는 동물(준비된 동물만 선택 목록에 뜬다)

  room: {
    w: 1536, h: 1024,
    floorTop: 610, floorBottom: 1000,    // 걸어 다닐 수 있는 깊이 범위
    minVisibleH: 680,                    // 창이 아주 넓어도 바닥 아래쪽 이만큼은 늘 보인다
    tallFill: 0.72, minVisibleW: 560,    // 세로로 긴 창(폰 세로): 방 그림이 창 높이의 이만큼은 채우게 키우고, 가로가 잘리면 카메라가 동물을 따라간다(최소 이 폭은 보임)
    nightFrom: 21, nightTo: 7,           // 자동 밤 시간(시)
  },

  pet: {
    width: 270,                          // 기본 자세(idle_breathe 0번) 몸 폭, 방 픽셀(뒤쪽 원근 기준). 시트 속 그림 크기와 무관하게 이 크기로 보인다
    size: { cat: 1, dog: 0.98, chick: 0.71, bear: 1.0, rabbit: 0.79 },   // 동물별 크기 배율 — v2 시트 속 상대 크기(idle 폭 비율) 그대로
    depthScale: [0.86, 1.08],            // 뒤쪽 ↔ 앞쪽 원근 배율(width 에 곱한다)
    gait: { walk: 120, run: 330, sneak: 62, zoomies: 520, ball_chase: 340 },   // 방 픽셀/초
    side: ['walk', 'run', 'sneak', 'zoomies', 'ball_chase', 'ball_push', 'ball_notice', 'toy_bite', 'tug'],
    gravity: 2600,
    look: { left: 0, upLeft: 1, up: 2, upRight: 3, right: 4, front: 5 },   // look_around 프레임 = 바라보는 방향
    names: { cat: '고양이', dog: '강아지', chick: '병아리', bear: '곰', rabbit: '토끼' },   // 버튼 표시용(없으면 키 그대로)
  },

  props: {   // 소품 종류·방에서의 크기(공통). 그림마다 다른 기준점은 아래 sets 에.
    ball: { item: 'ball_coral', d: 74 },
    plush: { item: 'fish_plush', w: 128 },
    rope: { item: 'tug_rope', w: 250 },
    treat: { item: 'treat', w: 54 },
    bowl: { item: 'food_bowl', w: 165, x: 455, y: 968 },
    feather: { item: 'feather', w: 74 },
    wand: { item: 'wand', w: 210 },
  },

  // 리소스 폴더별 가구 배치·그림 맞춤값(그림이 바뀌면 입구 위치·앞 파츠·소품 기준점이 바뀐다). 폴더 이름으로 고른다.
  // 가구: x,y = 바닥에 닿는 아래 가운데, w = 방에서의 폭, foot = 바닥 차지 타원(w 대비 반지름 [가로, 세로])
  //   kind: bed·cushion = 올라가 쉼 / box·cave = 폴짝 들어감, front(앞 파츠)를 동물 위에 다시 그림 / tunnel = 옆 입구로 걸어 들어감
  //   seat = 올라앉거나 들어간 바닥 높이(그림 높이 대비), hole = 입구 타원 [가운데 x, y, 반지름 x, y](그림 bbox 비율)
  //   occlude = 'all' | 'below' → 같은 그림을 입구(hole)만 빼고 동물 위에 다시 그려 앞 테두리로 쓴다('below' 는 입구 가운데 아래만)
  // 소품: rope.knots = 양 끝 매듭, feather.ring = 고리, feather.hang = 아래로 늘어지게 돌릴 각, wand.tip = 줄 달린 끝(모두 bbox 비율)
  sets: {
    desktop_pet_assets: {
      furniture: [
        { id: 'rug', item: 'rug', x: 770, y: 905, w: 640, flat: true },
        { id: 'bed', kind: 'bed', item: 'bed', x: 290, y: 705, w: 430, foot: [0.46, 0.16], seat: 0.36, hole: [0.5, 0.475, 0.31, 0.2], occlude: 'below', rest: true },
        { id: 'cushion', kind: 'cushion', item: 'cushion', x: 1295, y: 690, w: 300, foot: [0.45, 0.14], seat: 0.18, rest: true },
        { id: 'tunnel', kind: 'tunnel', item: 'tunnel_back', x: 770, y: 668, w: 430, foot: [0.47, 0.17], hole: [0.835, 0.54, 0.16, 0.39], occlude: 'all', deep: -0.28 },
        { id: 'box', kind: 'box', item: 'box_back', front: 'box_front', x: 1200, y: 958, w: 360, foot: [0.47, 0.17], seat: 0.10 },
      ],
      props: { rope: { knots: [[0.17, 0.78], [0.83, 0.2]] }, feather: { ring: [0.92, 0.04], hang: -0.68 }, wand: { tip: [0.96, 0.05] } },
    },
    desktop_pet_assets_v2: {
      furniture: [
        { id: 'rug', item: 'rug', x: 770, y: 905, w: 640, flat: true },
        { id: 'bed', kind: 'bed', item: 'bed', x: 290, y: 705, w: 430, foot: [0.46, 0.16], seat: 0.36, rest: true },   // 동물을 침대 위에 통째로 그린다(테두리 덮기는 몸이 잘려 보였음)
        { id: 'cushion', kind: 'cushion', item: 'cushion', x: 1295, y: 690, w: 300, foot: [0.45, 0.15], seat: 0.2, rest: true },
        { id: 'tunnel', kind: 'cave', item: 'tunnel_back', front: 'tunnel_front', x: 770, y: 676, w: 390, foot: [0.47, 0.2], seat: 0.04, hole: [0.49, 0.62, 0.33, 0.38], rest: true },
        { id: 'box', kind: 'box', item: 'box_back', front: 'box_front', x: 1215, y: 958, w: 420, foot: [0.47, 0.17], seat: 0.10 },
      ],
      props: { rope: { knots: [[0.16, 0.37], [0.84, 0.65]] }, feather: { ring: [0.92, 0.04], hang: -0.62 }, wand: { tip: [0.98, 0.03] } },
    },
  },

  // 욕구 변화(분당). 0~1. 방치해도 벌점·질병 없음 — 행동 고르는 가중치로만 쓴다.
  needs: {
    energyAwake: -0.024, energySleep: 0.06, energyNightExtra: -0.012,
    hungerUp: 0.005, funDown: 0.022, affectionDecay: 0.002, annoyHalfLife: 18,
  },
};
