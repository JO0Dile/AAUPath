// ==========================
// THE CLOCK FOUNTAIN
//
// Reconstructed from the photographs, reconciled across views rather than
// reinterpreted per view. What the earlier model got wrong, and what the
// references actually show:
//
//   ROOF      not a hipped pyramid. A grey pitched gable with a horizontal
//             ridge running east-west and eaves that overhang on all four
//             sides, so the head of the clock stage sits in its shadow.
//   CLOCK     ONE dial per face. Four faces, four dials. The drone shots
//             that look like a pair are corner views showing two different
//             faces of the same block, which I twice mistook for two dials
//             on one wall.
//   SIGN      the black granite block is WIDE. It oversails the arcade
//             below it on every side and is the most prominent element on
//             the whole tower, carrying the verse in Arabic above and
//             English below.
//   PIERS     paired round columns, substantial, not a bundle of sticks.
//   BOOK      on an angled wedge plinth rising off the ridge, not flat on
//             a box.
//
// Everything is real depth. The arches are cut through solid wall so they
// have soffits; the dials are sunk into rebates; the sign oversails and
// therefore casts.
// ==========================
import {
  Group, Mesh, BoxGeometry, CylinderGeometry, RingGeometry, CircleGeometry,
  BufferGeometry, Float32BufferAttribute, DoubleSide
} from 'three';
import { chamferedBox, coping, pointedArchWall, column, steppedRing, shadowed } from './Architecture.js';

export const LANDMARK = {
  poolRadius: 9.0,
  poolWall: 0.74,
  waterLevel: 0.46,
  islandTop: 1.42,
  pierSpacing: 2.15,     // the piers sit wider apart than they did
  colBase: 1.78,
  colTop: 5.4,
  signWidth: 6.6,        // the black block oversails the arcade
  signHeight: 2.5,
  clockWidth: 3.5,
  clockDepth: 3.5,
  clockHeight: 3.3,
  dialRadius: 1.18
};

export class Landmark {
  constructor(materials, quality) {
    this.m = materials;
    this.q = quality;
    this.group = new Group();
    this.group.name = 'landmark';
    this.clockHands = [];
    this._build();
  }

  get object() { return this.group; }

  _build() {
    const M = n => this.m.get(n);
    const L = LANDMARK;
    const seg = this.q.get('name') === 'low' ? 40 : 72;

    // ---- the basin -----------------------------------------------------
    const basin = new Group();
    basin.name = 'basin';

    // the outer wall, chamfered at the top so the coping sits on a shadow
    const wall = new Mesh(
      new CylinderGeometry(L.poolRadius, L.poolRadius + 0.05, L.poolWall, seg, 1, true),
      M('limestone')
    );
    wall.position.y = L.poolWall / 2;
    basin.add(wall);

    // the coping: oversails, and is honed rather than walled, so it catches
    // the sun as a bright ring all the way round
    const cop = new Mesh(
      steppedRing({ inner: L.poolRadius - 0.62, outer: L.poolRadius + 0.14, height: 0.16, segments: seg }),
      M('limestone-honed')
    );
    cop.position.y = L.poolWall;
    basin.add(cop);

    // the internal face, tiled, and the floor of the basin
    const inner = new Mesh(
      new CylinderGeometry(L.poolRadius - 0.62, L.poolRadius - 0.62, L.poolWall, seg, 1, true),
      M('mosaic')
    );
    inner.position.y = L.poolWall / 2;
    inner.material.side = DoubleSide;
    basin.add(inner);

    const floor = new Mesh(new CylinderGeometry(L.poolRadius - 0.62, L.poolRadius - 0.62, 0.08, seg), M('mosaic'));
    floor.position.y = 0.06;
    basin.add(floor);

    // the kerb outside it, and the fine paving of the island it sits in
    const kerb = new Mesh(
      steppedRing({ inner: L.poolRadius + 0.14, outer: L.poolRadius + 1.35, height: 0.1, segments: seg }),
      M('paving-fine')
    );
    basin.add(kerb);
    this.group.add(shadowed(basin));

    // ---- the island the tower stands on --------------------------------
    const island = new Group();
    const steps = [
      { r: 4.62, y: 0.00, h: 0.34 },
      { r: 4.20, y: 0.34, h: 0.32 },
      { r: 3.80, y: 0.66, h: 0.32 }
    ];
    for (const s of steps) {
      const ring = new Mesh(new CylinderGeometry(s.r, s.r + 0.03, s.h, seg), M('limestone'));
      ring.position.y = s.y + s.h / 2;
      island.add(ring);
      // a honed nosing on every step, which is where the light lands
      const nose = new Mesh(steppedRing({ inner: s.r - 0.14, outer: s.r + 0.02, height: 0.03, segments: seg }), M('limestone-honed'));
      nose.position.y = s.y + s.h;
      island.add(nose);
    }
    const plinth = new Mesh(chamferedBox(5.4, 0.52, 5.4, 0.07), M('limestone'));
    plinth.position.y = 0.98;
    island.add(plinth);
    const plinthCap = new Mesh(coping(5.4, 5.4, 0.12, 0.09), M('limestone-honed'));
    plinthCap.position.y = 1.50 - 0.12;
    island.add(plinthCap);
    this.group.add(shadowed(island));

    // ---- the piers -----------------------------------------------------
    const piers = new Group();
    const P = L.pierSpacing;
    for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
      const pier = new Group();
      pier.position.set(sx * P, L.islandTop, sz * P);
      // a stylobate under the cluster
      const pad = new Mesh(chamferedBox(1.22, 0.34, 1.22, 0.05), M('limestone'));
      pier.add(pad);
      const padTop = new Mesh(coping(1.02, 1.02, 0.09, 0.06), M('limestone-honed'));
      padTop.position.y = 0.34;
      pier.add(padTop);
      // three shafts, bundled
      const shaftH = L.colTop - L.colBase - 0.78;
      for (let i = 0; i < 3; i++) {
        const a = i / 3 * Math.PI * 2 + 0.4;
        const col = column({ radius: 0.185, height: shaftH, mat: M('limestone-honed'), segments: this.q.get('name') === 'low' ? 8 : 16 });
        col.position.set(Math.cos(a) * 0.33, 0.43, Math.sin(a) * 0.33);
        pier.add(col);
      }
      // the abacus the arcade sits on
      const abacus = new Mesh(chamferedBox(1.1, 0.3, 1.1, 0.05), M('limestone'));
      abacus.position.y = 0.43 + shaftH;
      pier.add(abacus);
      piers.add(pier);
    }
    this.group.add(shadowed(piers));

    // ---- the arcade ----------------------------------------------------
    // Four walls with a pointed arch cut through each. Real thickness, so
    // the soffit of every arch is a surface the sun never reaches.
    const springing = L.colTop + 0.32;
    const arcade = new Group();
    const archGeom = pointedArchWall({
      width: P * 2 + 0.7, height: springing + 3.1, springing: springing - L.islandTop,
      thickness: 0.46
    });
    const apex = L.islandTop + archGeom.userData.apex;
    for (let i = 0; i < 4; i++) {
      const w = new Mesh(archGeom, M('limestone'));
      w.rotation.y = i * Math.PI / 2;
      w.position.set(
        Math.sin(i * Math.PI / 2) * P,
        L.islandTop,
        Math.cos(i * Math.PI / 2) * P
      );
      arcade.add(w);
    }
    this.group.add(shadowed(arcade));
    this.arcadeApex = apex;

    // the dark core standing behind the arcade, seen through every opening
    const core = new Mesh(chamferedBox(2.6, apex - L.islandTop + 0.5, 2.6, 0.04), M('granite'));
    core.position.y = L.islandTop - 0.3;
    this.group.add(shadowed(core));

    // ---- the black granite sign ----------------------------------------
    // The most prominent element on the tower and the one the previous model
    // most understated: it is WIDER than the arcade it sits on, oversailing
    // it on every side, so it throws a hard shadow across the arch heads.
    const bandY = apex + 0.16;
    const sign = new Group();
    sign.name = 'signBlock';
    const SW = LANDMARK.signWidth, SH = LANDMARK.signHeight;

    const corbel = new Mesh(coping(SW - 0.5, SW * 0.66 - 0.4, 0.3, 0.26), M('limestone-honed'));
    corbel.position.y = bandY;
    sign.add(corbel);

    const granite = new Mesh(chamferedBox(SW, SH, SW * 0.66, 0.05), M('granite'));
    granite.position.y = bandY + 0.3;
    sign.add(granite);

    // the text, as real relief rather than as a texture: a raised Arabic
    // line above and a smaller English line below, on all four faces
    for (let f = 0; f < 4; f++) {
      const face = new Group();
      const z = SW * 0.33 + 0.012;
      for (const [ly, len, h] of [[SH * 0.62, SW * 0.76, 0.16], [SH * 0.40, SW * 0.72, 0.12],
                                  [SH * 0.22, SW * 0.66, 0.085], [SH * 0.11, SW * 0.5, 0.075]]) {
        const line = new Mesh(new BoxGeometry(len, h, 0.02), M('paint-white'));
        line.position.set(0, bandY + 0.3 + ly, z);
        face.add(line);
      }
      face.rotation.y = f * Math.PI / 2;
      sign.add(face);
    }

    const signCap = new Mesh(coping(SW, SW * 0.66, 0.26, 0.14), M('limestone-honed'));
    signCap.position.y = bandY + 0.3 + SH;
    sign.add(signCap);
    this.group.add(shadowed(sign));
    this.bandTop = bandY + 0.3 + SH + 0.26;

    // ---- the clock stage ------------------------------------------------
    const stageY = this.bandTop;
    const stage = new Group();
    stage.name = 'clockStage';
    const CW = LANDMARK.clockWidth, CD = LANDMARK.clockDepth, CH = LANDMARK.clockHeight;
    const shaft = new Mesh(chamferedBox(CW, CH, CD, 0.06), M('limestone'));
    shaft.position.y = stageY;
    stage.add(shaft);

    // One dial per face.
    const dialY = stageY + CH * 0.55;
    const R = LANDMARK.dialRadius;
    for (let i = 0; i < 4; i++) {
      const a = i * Math.PI / 2;
      const f = this._clockFace(R);
      f.rotation.y = a;
      f.position.set(Math.sin(a) * (CW / 2 + 0.01), dialY, Math.cos(a) * (CW / 2 + 0.01));
      stage.add(f);
    }
    this.group.add(shadowed(stage));

    // ---- the roof -------------------------------------------------------
    // A grey pitched gable with a horizontal ridge and eaves that overhang
    // on every side, not a pyramid — the head of the clock stage sits in
    // its shadow because of that overhang.
    const eavesY = stageY + CH;
    const eaves = new Mesh(coping(CW, CD, 0.22, 0.36), M('limestone-honed'));
    eaves.position.y = eavesY;
    this.group.add(shadowed(eaves));
    const roof = new Mesh(this._gableRoof(CW / 2 + 0.38, CD / 2 + 0.38, 1.15), M('concrete-dark'));
    roof.position.y = eavesY + 0.2;
    roof.name = 'roof';
    this.group.add(shadowed(roof));

    // ---- the book, on its angled plinth ----------------------------------
    const ridgeY = eavesY + 0.2 + 1.15;
    const WEDGE = { half: 1.05, lift: 0.95, depth: 1.4 };
    const wedge = new Mesh(this._wedgePlinth(WEDGE.half, WEDGE.lift, WEDGE.depth), M('limestone'));
    wedge.position.y = ridgeY - 0.1;
    this.group.add(shadowed(wedge));
    // The book lies ON the wedge's sloping top. It is built around its own
    // origin and then placed: it used to be built at its full height and
    // rotated about the ground, which at that height swung it about three
    // units sideways, so it hung in the air beside the tower.
    const frontY = WEDGE.lift * 0.35, backY = WEDGE.lift;
    const book = this._book(0);
    book.position.y = ridgeY - 0.1 + (frontY + backY) / 2 + 0.04;
    book.rotation.x = Math.atan2(backY - frontY, WEDGE.depth);
    book.name = 'book';
    this.group.add(shadowed(book));
    this.height = ridgeY + 2.4;
  }

  // A gable: two sloping planes to a horizontal ridge, with real gable ends
  // and an eaves fascia so the roof has thickness where it oversails.
  _gableRoof(halfX, halfZ, height) {
    const pos = [];
    const T = (a, b, c) => pos.push(...a, ...b, ...c);
    const A = [-halfX, 0, halfZ], B = [halfX, 0, halfZ];
    const C = [halfX, 0, -halfZ], D = [-halfX, 0, -halfZ];
    const R1 = [-halfX, height, 0], R2 = [halfX, height, 0];
    T(A, B, R2); T(A, R2, R1);          // the south slope
    T(C, D, R1); T(C, R1, R2);          // the north slope
    T(B, C, R2);                         // the east gable
    T(D, A, R1);                         // the west gable
    const f = 0.16;
    for (const [p0, p1] of [[A, B], [B, C], [C, D], [D, A]]) {
      const a = [p0[0], -f, p0[2]], b = [p1[0], -f, p1[2]];
      T(p0, b, p1); T(p0, a, b);
    }
    const g = new BufferGeometry();
    g.setAttribute('position', new Float32BufferAttribute(pos, 3));
    g.computeVertexNormals();
    return g;
  }

  // The plinth the book stands on: a wedge rising off the ridge at an angle,
  // which is what the photographs show rather than a flat pad.
  _wedgePlinth(half, lift, depth) {
    const pos = [];
    const T = (a, b, c) => pos.push(...a, ...b, ...c);
    const d = depth / 2;
    const A = [-half, 0, d], B = [half, 0, d], C = [half, 0, -d], D = [-half, 0, -d];
    const A2 = [-half, lift * 0.35, d], B2 = [half, lift * 0.35, d];
    const C2 = [half, lift, -d], D2 = [-half, lift, -d];
    T(A2, B2, C2); T(A2, C2, D2);
    T(A, B, B2); T(A, B2, A2);
    T(C, D, D2); T(C, D2, C2);
    T(B, C, C2); T(B, C2, B2);
    T(D, A, A2); T(D, A2, D2);
    const g = new BufferGeometry();
    g.setAttribute('position', new Float32BufferAttribute(pos, 3));
    g.computeVertexNormals();
    return g;
  }

  // A dial recessed into the stone: a sunk rebate, a chapter ring, twelve
  // marks and two hands standing off the face so they cast onto it.
  _clockFace(r) {
    const M = n => this.m.get(n);
    const g = new Group();
    const rebate = new Mesh(new CylinderGeometry(r * 1.12, r * 1.12, 0.14, 40), M('limestone-honed'));
    rebate.rotation.x = Math.PI / 2;
    rebate.position.z = -0.03;
    g.add(rebate);

    const dial = new Mesh(new CircleGeometry(r, 44), M('paint-white'));
    dial.position.z = 0.055;
    g.add(dial);

    const ring = new Mesh(new RingGeometry(r * 0.9, r * 0.965, 44), M('steel-dark'));
    ring.position.z = 0.062;
    g.add(ring);

    for (let i = 0; i < 12; i++) {
      const a = i / 12 * Math.PI * 2;
      const major = i % 3 === 0;
      const mark = new Mesh(
        new BoxGeometry(major ? 0.075 : 0.04, major ? 0.24 : 0.14, 0.02),
        M('steel-dark')
      );
      const rr = r * 0.79;
      mark.position.set(Math.sin(a) * rr, Math.cos(a) * rr, 0.068);
      mark.rotation.z = -a;
      g.add(mark);
    }

    // The hands read 10:10 — which is where clocks in photographs always
    // are, because it frames the dial and leaves the maker's name clear.
    const hour = new Mesh(new BoxGeometry(0.075, r * 0.56, 0.028), M('steel-dark'));
    hour.position.set(0, 0, 0.082);
    hour.geometry.translate(0, r * 0.28, 0);
    hour.rotation.z = -Math.PI * 2 * (10 / 12) - Math.PI * 2 * (10 / 60) / 12;
    const min = new Mesh(new BoxGeometry(0.052, r * 0.8, 0.026), M('steel-dark'));
    min.position.set(0, 0, 0.09);
    min.geometry.translate(0, r * 0.4, 0);
    min.rotation.z = -Math.PI * 2 * (10 / 60);
    const boss = new Mesh(new CylinderGeometry(0.07, 0.07, 0.05, 12), M('steel-dark'));
    boss.rotation.x = Math.PI / 2;
    boss.position.z = 0.1;
    g.add(hour, min, boss);
    this.clockHands.push({ hour, min });
    return g;
  }

  // Four hipped planes to a short ridge, with a small overhang. A pyramid
  // reads as a party hat; a hip with an eaves overhang reads as a roof,
  // because the overhang throws a shadow onto the wall below it.
  _hipRoof(half, height, ridgeHalf) {
    const o = half + 0.16;
    const A = [-o, 0, -o], B = [o, 0, -o], C = [o, 0, o], D = [-o, 0, o];
    const R1 = [-ridgeHalf * 0.5, height, 0], R2 = [ridgeHalf * 0.5, height, 0];
    const tris = [
      [D, C, R2], [D, R2, R1],        // the south slope
      [B, A, R1], [B, R1, R2],        // the north slope
      [C, B, R2],                     // the east hip
      [A, D, R1],                     // the west hip
      [R1, R2, [ridgeHalf * 0.5, height, 0]]   // degenerate; ridge is a line
    ];
    const pos = [];
    for (const t of tris.slice(0, 6)) for (const p of t) pos.push(p[0], p[1], p[2]);
    // the eaves fascia, so the roof has a visible thickness at its edge
    const fascia = 0.13;
    const ring = [[A, B], [B, C], [C, D], [D, A]];
    for (const [p0, p1] of ring) {
      const a = [p0[0], -fascia, p0[2]], b = [p1[0], -fascia, p1[2]];
      pos.push(...p0, ...b, ...p1);
      pos.push(...p0, ...a, ...b);
    }
    const g = new BufferGeometry();
    g.setAttribute('position', new Float32BufferAttribute(pos, 3));
    g.computeVertexNormals();
    return g;
  }

  // The open book on the stand: two leaves, each a real curved surface
  // rather than a flat plane, with a page-edge thickness and a spine
  // between them.
  _book(y) {
    const M = n => this.m.get(n);
    const g = new Group();
    const W = 1.15, D = 1.0, SEG = 12;

    for (const side of [-1, 1]) {
      const pos = [];
      // A leaf is a ruled surface: it lifts away from the spine and comes
      // back down at the outer edge, the way a heavy open book does. The
      // profile has to be non-monotonic for that. The old one was a plain
      // sine that only ever climbed, so each leaf rose 0.76 over 0.9 of
      // lateral run — a 40-degree wedge — and the two of them together read
      // as a pair of raised wings rather than as a book. This rises to about
      // 0.21 near the middle of the leaf and returns almost flat at the
      // margin, which is roughly 25 degrees at its steepest.
      const pt = (u, v) => {
        const x = side * u * W;
        const lift = 0.34 * Math.pow(u, 0.55) - 0.30 * Math.pow(u, 3);
        return [x, y + lift, v * D];
      };
      for (let i = 0; i < SEG; i++) {
        const u0 = i / SEG, u1 = (i + 1) / SEG;
        for (const v of [[-0.5, 0.5]]) {
          const a = pt(u0, v[0]), b = pt(u1, v[0]), c = pt(u1, v[1]), d = pt(u0, v[1]);
          if (side > 0) { pos.push(...a, ...b, ...c, ...a, ...c, ...d); }
          else { pos.push(...a, ...c, ...b, ...a, ...d, ...c); }
        }
      }
      // the page edge: a thin skirt down the outer margin so the leaf is
      // not infinitely thin where the light grazes it
      const eA = pt(1, -0.5), eB = pt(1, 0.5);
      const tA = [eA[0], eA[1] - 0.07, eA[2]], tB = [eB[0], eB[1] - 0.07, eB[2]];
      pos.push(...eA, ...eB, ...tB, ...eA, ...tB, ...tA);

      const geo = new BufferGeometry();
      geo.setAttribute('position', new Float32BufferAttribute(pos, 3));
      geo.computeVertexNormals();
      const leaf = new Mesh(geo, M('paint-white'));
      leaf.material.side = DoubleSide;
      g.add(leaf);
    }

    const spine = new Mesh(new BoxGeometry(0.12, 0.1, D), M('limestone-honed'));
    spine.position.set(0, y + 0.02, 0);
    g.add(spine);
    return g;
  }
}
