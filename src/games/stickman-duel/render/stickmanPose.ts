import type { StickFighter } from '../types';

export interface Vec2 {
  x: number;
  y: number;
}

export type StickmanLocomotionState =
  | 'ko'
  | 'hitstun'
  | 'attack'
  | 'double_jump_tuck'
  | 'jump_rise'
  | 'air_apex'
  | 'air_fall'
  | 'landing'
  | 'crouch'
  | 'skid'
  | 'sprint'
  | 'walk'
  | 'idle';

export interface StickmanPose {
  locomotion: StickmanLocomotionState;
  hip: Vec2;
  /** 二次贝塞尔脊柱中段控制点，使躯干具有自然弯曲与蓄力弧度 */
  spineMid: Vec2;
  shoulder: Vec2;
  head: Vec2;
  /** 头部微仰/微俯倾角（弧度），用于护目镜/头带朝向微调 */
  headTilt: number;
  backKnee: Vec2;
  backFoot: Vec2;
  frontKnee: Vec2;
  frontFoot: Vec2;
  backElbow: Vec2;
  backHand: Vec2;
  frontElbow: Vec2;
  frontHand: Vec2;
  /** 整体动作弹性形变（起跳拉伸 / 落地缓冲下压） */
  poseScaleX: number;
  poseScaleY: number;
  weaponAngle: number;
  /** 是否处于动作高爆发帧（供渲染器绘制拳/脚残影） */
  isActiveStrike: boolean;
}

/** 解剖学骨骼节段长度常量（与 50px 身高碰撞盒精确匹配） */
export const STICK_TORSO_LEN = 18;
export const STICK_THIGH_LEN = 12;
export const STICK_SHIN_LEN = 12.5;
export const STICK_UPPER_ARM_LEN = 10.5;
export const STICK_FOREARM_LEN = 10.5;

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function lerpVec(a: Vec2, b: Vec2, t: number): Vec2 {
  return { x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t) };
}

function lerpAngle(a: number, b: number, t: number): number {
  let diff = b - a;
  while (diff > Math.PI) diff -= Math.PI * 2;
  while (diff < -Math.PI) diff += Math.PI * 2;
  return a + diff * t;
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = clamp((x - edge0) / Math.max(0.0001, edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

/**
 * 标准 2-Bone 解析逆向运动学（IK）：
 * 给定根节点 root、目标点 target、上节长度 len1、下节长度 len2 及弯曲方向 bendSign（+1 / -1），
 * 返回精确保持骨骼长度不变的中间关节坐标（膝盖 / 手肘）与限幅后的末端点。
 */
export function solveTwoBoneIK(
  root: Vec2,
  target: Vec2,
  len1: number,
  len2: number,
  bendSign: -1 | 1
): { joint: Vec2; end: Vec2 } {
  const dx = target.x - root.x;
  const dy = target.y - root.y;
  const rawDist = Math.hypot(dx, dy);
  const minDist = Math.abs(len1 - len2) + 0.5;
  const maxDist = len1 + len2 - 0.15;
  const dist = clamp(rawDist, minDist, maxDist);

  const ux = rawDist > 0.0001 ? dx / rawDist : 0;
  const uy = rawDist > 0.0001 ? dy / rawDist : 1;

  // 余弦定理求上节相对连线方向的夹角
  const cosA = clamp((len1 * len1 + dist * dist - len2 * len2) / (2 * len1 * dist), -1, 1);
  const sinA = Math.sqrt(Math.max(0, 1 - cosA * cosA));

  // 垂直向量 (-uy, ux) 决定膝盖或手肘朝哪侧弯曲
  const px = -uy * bendSign;
  const py = ux * bendSign;

  const joint: Vec2 = {
    x: root.x + (ux * cosA + px * sinA) * len1,
    y: root.y + (uy * cosA + py * sinA) * len1,
  };
  const end: Vec2 = {
    x: root.x + ux * dist,
    y: root.y + uy * dist,
  };
  return { joint, end };
}

/**
 * 计算火柴人当前帧的目标程序化骨骼姿态：
 * 覆盖格斗待机律动、慢走/疾跑连续渐变、急转刹步、起跳拉伸、滞空悬浮、
 * 急速下坠、二段跳抱膝空翻、落地缓冲深蹲、三段连拳、高位飞踢、双手挥剑与受击后仰。
 */
export function computeTargetStickmanPose(
  f: Pick<
    StickFighter,
    | 'x'
    | 'vx'
    | 'vy'
    | 'facing'
    | 'aimX'
    | 'aimY'
    | 'alive'
    | 'onGround'
    | 'jumpsUsed'
    | 'runPhase'
    | 'airSpinAngle'
    | 'landingTimer'
    | 'landingStrength'
    | 'takeoffTimer'
    | 'skidTimer'
    | 'hitStunTimer'
    | 'recoilTimer'
    | 'attack'
    | 'weapon'
  > & { crouching?: boolean },
  elapsedVisual: number,
  maxMoveSpeed = 295
): StickmanPose {
  const dir = f.facing;
  const absVx = Math.abs(f.vx);
  const speedRatio = clamp(absVx / Math.max(120, maxMoveSpeed), 0, 1);
  const sprintBlend = smoothstep(0.45, 0.88, speedRatio);
  const isAirborne = !f.onGround;
  const isCrouching = Boolean(f.crouching && f.onGround);
  const isWalking = f.onGround && !isCrouching && speedRatio > 0.08;
  const isJumping = isAirborne && f.vy < -60;
  const isFalling = isAirborne && f.vy > 80;
  const gaitBlend = isWalking ? smoothstep(0.08, 0.30, speedRatio) : 0;
  const riseBlend = isJumping ? smoothstep(-60, -420, f.vy) : 0;
  const fallBlend = isFalling ? smoothstep(80, 440, f.vy) : 0;
  const apexBlend = 1 - riseBlend - fallBlend;

  // 确定当前核心动作态，便于外部查询与差异化插值
  const attack = f.attack;
  const atkRatio = attack ? clamp(attack.elapsed / Math.max(0.01, attack.totalDuration), 0, 1) : 0;
  const isActiveStrike = attack
    ? attack.elapsed >= attack.startup && attack.elapsed <= attack.activeEnd
    : false;
  const isTuckFlip = !f.onGround && f.jumpsUsed >= 2 && f.airSpinAngle > 0.02;
  const isLanding = f.onGround && f.landingTimer > 0.005;
  const isSkidding = f.onGround && !isCrouching && f.skidTimer > 0.005 && absVx > 70;

  let locomotion: StickmanLocomotionState = 'idle';
  if (!f.alive) locomotion = 'ko';
  else if (f.hitStunTimer > 0) locomotion = 'hitstun';
  else if (attack) locomotion = 'attack';
  else if (isTuckFlip) locomotion = 'double_jump_tuck';
  else if (isJumping) locomotion = 'jump_rise';
  else if (isFalling) locomotion = 'air_fall';
  else if (isAirborne) locomotion = 'air_apex';
  else if (isCrouching) locomotion = 'crouch';
  else if (isLanding && speedRatio < 0.55) locomotion = 'landing';
  else if (isSkidding) locomotion = 'skid';
  else if (isWalking) locomotion = speedRatio >= 0.55 ? 'sprint' : 'walk';

  // 格斗戒备呼吸节奏（带微弱相位差，场上每个火柴人律动自然错开）
  const idleWave = Math.sin(elapsedVisual * 5.6 + f.x * 0.02);
  const idlePulse = Math.sin(elapsedVisual * 11.2 + f.x * 0.02);

  // 弹性形变：起跳瞬间竖向拉伸，落地瞬间横向缓冲微压
  let poseScaleX = 1;
  let poseScaleY = 1;
  if (f.takeoffTimer > 0 && !f.onGround) {
    const t = clamp(f.takeoffTimer / 0.13, 0, 1);
    poseScaleX = 1 - 0.1 * t;
    poseScaleY = 1 + 0.13 * t;
  } else if (isLanding) {
    const lt = clamp(f.landingTimer / 0.22, 0, 1);
    const sq = Math.sin(lt * Math.PI) * f.landingStrength;
    poseScaleX = 1 + 0.15 * sq;
    poseScaleY = 1 - 0.15 * sq;
  } else if (isCrouching) {
    poseScaleX = 1.06;
    poseScaleY = 0.94;
  }

  // ===== 1. 躯干、重心（hip）与脊柱弧度（spineCurve） =====
  let hipX = 0;
  let hipY = -20.5;
  let lean = dir * 0.12;
  /** 脊柱弯曲偏移：正值表示顺面朝方向弓背/含胸，负值表示挺胸/受击后仰 */
  let spineArch = dir * 1.2;
  let headTilt = 0;

  if (!f.alive) {
    hipY = -19;
    lean = -dir * 0.52;
    spineArch = -dir * 5;
    headTilt = -dir * 0.35;
  } else if (f.hitStunTimer > 0) {
    // 受击 C 型后仰踉跄
    hipX = -dir * 4.5;
    hipY = -18.5;
    lean = -dir * 0.46;
    spineArch = -dir * 5.2;
    headTilt = -dir * 0.32;
  } else if (isTuckFlip) {
    // 二段跳紧缩抱膝空翻姿态
    hipX = 0;
    hipY = -22;
    lean = dir * 0.58;
    spineArch = dir * 5.6;
    headTilt = dir * 0.38;
  } else if (!f.onGround) {
    // 空中三阶段姿态平滑过渡：起跳冲升 -> 顶点悬浮 -> 高速下坠
    const airHorizLean = clamp(f.vx / 320, -1, 1) * 0.24;
    hipY = -21.5 + fallBlend * 1.2 - riseBlend * 1.5;
    lean =
      dir * (0.2 * riseBlend + 0.16 * apexBlend - 0.1 * fallBlend) +
      airHorizLean;
    spineArch = dir * (2.6 * (1 - fallBlend) - 2.4 * fallBlend);
    headTilt = -0.18 * riseBlend + 0.22 * fallBlend;
  } else if (isCrouching) {
    // 贴地深蹲戒备：大幅压低重心（与 32px 下蹲碰撞盒严格一致），闪避上段拳击
    const crouchWalkBob = absVx > 10 ? Math.abs(Math.sin(f.runPhase * 1.15)) * 1.4 : idleWave * 0.65;
    hipX = -dir * 1.5;
    hipY = -10.5 + crouchWalkBob;
    lean = dir * (0.58 + speedRatio * 0.14);
    spineArch = dir * 4.4;
    headTilt = -dir * 0.26;
  } else if (isSkidding) {
    // 高速急转刹步：重心压低、上身后仰抵消惯性
    hipX = -dir * 3;
    hipY = -17.5;
    lean = -dir * 0.32;
    spineArch = -dir * 2.2;
    headTilt = dir * 0.12;
  } else {
    // 随实际地速在待机、慢走与疾跑之间混合重心和前倾。
    const doubleStepBounce = Math.abs(Math.sin(f.runPhase));
    const walkBob = doubleStepBounce * 2.1;
    const sprintBob = doubleStepBounce * 3.4;
    hipX = Math.sin(elapsedVisual * 2.8 + f.x * 0.02) * 1.1 * (1 - gaitBlend);
    hipY = lerp(
      -20 + idleWave * 1.35 + idlePulse * 0.25,
      -20.5 + lerp(walkBob, sprintBob, sprintBlend) - sprintBlend * 1.4,
      gaitBlend
    );
    lean = dir * lerp(0.12 + idleWave * 0.045, lerp(0.14, 0.46, sprintBlend), gaitBlend);
    spineArch = dir * lerp(1.5 + idleWave * 0.4, lerp(1.0, 3.6, sprintBlend), gaitBlend);
    headTilt = dir * lerp(0.03, -0.08, sprintBlend) * gaitBlend;
  }

  // 叠加落地深蹲缓冲（允许在落地移动起步时也顺滑过渡）
  if (isLanding && f.alive && f.hitStunTimer <= 0) {
    const lt = clamp(f.landingTimer / 0.22, 0, 1);
    const crouch = Math.sin(lt * Math.PI) * f.landingStrength;
    hipY += crouch * 6.5;
    lean += dir * crouch * 0.24;
    spineArch += dir * crouch * 2.8;
  }

  // 叠加攻击动作的躯干蓄力与爆发
  if (attack && f.alive && f.hitStunTimer <= 0) {
    if (attack.kind === 'punch') {
      const windup = atkRatio < 0.22 ? atkRatio / 0.22 : 0;
      const strike = isActiveStrike ? 1 : atkRatio > 0.22 ? Math.max(0, 1 - (atkRatio - 0.5) / 0.5) : 0;
      if (attack.comboStep === 2) {
        // 第 3 段上勾重拳：下蹲蓄力 -> 猛然仰身冲拳
        hipY += windup * 4 - strike * 2.8;
        lean = dir * (windup > 0 ? 0.35 : -0.18 * strike + 0.14);
        spineArch = dir * (windup > 0 ? 3.5 : -3.2 * strike);
      } else if (attack.comboStep === 1) {
        // 第 2 段重直拳：深跨步前探
        hipX += dir * strike * 3.5;
        lean = dir * (0.12 + strike * 0.42);
        spineArch = dir * (2.6 * strike);
      } else {
        // 第 1 段快刺拳
        hipX += dir * strike * 2;
        lean = dir * (0.14 + strike * 0.3);
      }
    } else if (attack.kind === 'kick') {
      // 站姿高位飞踢 vs 蹲姿贴地扫腿
      const ext = isActiveStrike
        ? 1
        : atkRatio < 0.28
        ? atkRatio / 0.28
        : Math.max(0, 1 - (atkRatio - 0.56) / 0.44);
      if (isCrouching) {
        lean = -dir * (0.1 + ext * 0.22);
        hipY = -9.5 + ext * 1.2;
        spineArch = -dir * (1.2 + ext * 1.6);
      } else {
        lean = -dir * (0.14 + ext * 0.34);
        hipY -= ext * 2.8;
        spineArch = -dir * (1.5 + ext * 2.6);
      }
    } else if (attack.kind === 'sword') {
      // 蓄力上举 -> 前扑大弧斩 -> 收势前倾
      if (atkRatio < 0.22) {
        const w = atkRatio / 0.22;
        lean = -dir * (0.12 + w * 0.22);
        hipY += w * 1.8;
        spineArch = -dir * (2.4 * w);
      } else {
        const s = clamp((atkRatio - 0.22) / 0.4, 0, 1);
        const ease = 1 - Math.pow(1 - s, 3);
        lean = lerp(-dir * 0.28, dir * 0.54, ease);
        hipX += dir * ease * 4.2;
        hipY += ease * 1.4;
        spineArch = dir * (3.6 * ease);
      }
    } else if (
      (attack.kind === 'shotgun' || attack.kind === 'rocket' || attack.kind === 'pistol') &&
      atkRatio < 0.45
    ) {
      // 开枪瞬间上身微后坐仰角
      const kick = Math.sin((atkRatio / 0.45) * Math.PI);
      const kickAmp = attack.kind === 'pistol' ? 0.12 : 0.26;
      lean -= dir * kick * kickAmp;
      hipX -= dir * kick * (attack.kind === 'pistol' ? 1.2 : 3.2);
    }
  }

  const hip: Vec2 = { x: hipX, y: hipY };
  const shoulder: Vec2 = {
    x: hip.x + Math.sin(lean) * STICK_TORSO_LEN,
    y: hip.y - Math.cos(lean) * STICK_TORSO_LEN,
  };
  const spineMid: Vec2 = {
    x: (hip.x + shoulder.x) * 0.5 + spineArch * 0.65,
    y: (hip.y + shoulder.y) * 0.5 + Math.abs(spineArch) * 0.14,
  };
  const head: Vec2 = {
    x: shoulder.x + Math.sin(lean * 0.78 + headTilt * 0.5) * 9.2,
    y: shoulder.y - Math.cos(lean * 0.55) * 9.5,
  };

  // ===== 2. 腿部目标脚掌坐标 + 2-Bone 膝盖 IK =====
  let backFootTarget: Vec2;
  let frontFootTarget: Vec2;
  // 膝盖默认朝面朝方向弯曲（在屏幕 Y 向下坐标系下，facing=1 时弯曲向量需取 -1）
  let backKneeBend: -1 | 1 = dir === 1 ? -1 : 1;
  let frontKneeBend: -1 | 1 = dir === 1 ? -1 : 1;

  if (!f.alive) {
    backFootTarget = { x: hip.x - dir * 13, y: hip.y + 18 };
    frontFootTarget = { x: hip.x + dir * 11, y: hip.y + 20 };
  } else if (f.hitStunTimer > 0) {
    // 受击双腿踉跄失衡
    backFootTarget = { x: hip.x - dir * 12, y: f.onGround ? 0 : hip.y + 18 };
    frontFootTarget = { x: hip.x + dir * 9, y: f.onGround ? -3 : hip.y + 13 };
  } else if (attack?.kind === 'kick') {
    const ext = isActiveStrike
      ? 1
      : atkRatio < 0.26
      ? atkRatio / 0.26
      : Math.max(0, 1 - (atkRatio - 0.56) / 0.44);
    // 支撑腿（地面稳撑 / 空中收膝成飞踢）
    backFootTarget = f.onGround
      ? { x: hip.x - dir * (isCrouching ? 9.5 : 7.5), y: 0 }
      : { x: hip.x - dir * 11, y: hip.y + 14 };
    // 踢击腿：蹲姿贴地扫腿 / 站姿高位鞭腿
    if (atkRatio < 0.24) {
      frontFootTarget = isCrouching
        ? { x: hip.x + dir * 9, y: -2 }
        : { x: hip.x + dir * 11, y: hip.y + 4 };
    } else if (isCrouching) {
      frontFootTarget = {
        x: hip.x + dir * (15 + ext * 24),
        y: -2.5 - ext * 2,
      };
    } else {
      frontFootTarget = {
        x: hip.x + dir * (16 + ext * 22),
        y: hip.y - 4 - ext * 10,
      };
    }
  } else if (isTuckFlip) {
    // 二段跳紧缩抱膝团身
    backFootTarget = { x: hip.x - dir * 6, y: hip.y + 10 };
    frontFootTarget = { x: hip.x + dir * 5, y: hip.y + 8 };
  } else if (!f.onGround) {
    // 空中三态腿姿平滑融合
    // 起跳：前膝高抬、后腿潇洒斜后伸展
    const riseFront: Vec2 = { x: hip.x + dir * 8, y: hip.y + 10 };
    const riseBack: Vec2 = { x: hip.x - dir * 12, y: hip.y + 22 };
    // 滞空顶点：不对称凌空微蜷
    const apexFront: Vec2 = { x: hip.x + dir * 9, y: hip.y + 14 };
    const apexBack: Vec2 = { x: hip.x - dir * 11, y: hip.y + 17 };
    // 急速下坠：双脚下探准备缓冲落地
    const fallFront: Vec2 = { x: hip.x + dir * 7, y: hip.y + 22 };
    const fallBack: Vec2 = { x: hip.x - dir * 9, y: hip.y + 19 };

    frontFootTarget = {
      x: riseFront.x * riseBlend + apexFront.x * apexBlend + fallFront.x * fallBlend,
      y: riseFront.y * riseBlend + apexFront.y * apexBlend + fallFront.y * fallBlend,
    };
    backFootTarget = {
      x: riseBack.x * riseBlend + apexBack.x * apexBlend + fallBack.x * fallBlend,
      y: riseBack.y * riseBlend + apexBack.y * apexBlend + fallBack.y * fallBlend,
    };
  } else if (isCrouching) {
    // 蹲姿双膝深屈贴地（移动时小步蹲行）
    const crouchWalkBlend = smoothstep(0.04, 0.24, speedRatio);
    const swing = Math.sin(f.runPhase * 1.15);
    const liftF = Math.max(0, Math.cos(f.runPhase * 1.15)) * 2.8 * crouchWalkBlend;
    const liftB = Math.max(0, -Math.cos(f.runPhase * 1.15)) * 2.8 * crouchWalkBlend;
    frontFootTarget = { x: hip.x + dir * (12 + swing * 5.5 * crouchWalkBlend), y: -liftF };
    backFootTarget = { x: hip.x - dir * (10.5 - swing * 5.5 * crouchWalkBlend), y: -liftB };
  } else if (isSkidding) {
    // 急停刹步：前脚斜前蹬地刹车，后脚屈膝压低
    frontFootTarget = { x: hip.x + dir * 15, y: 0 };
    backFootTarget = { x: hip.x - dir * 11, y: 0 };
  } else {
    // 椭圆轨迹步态：慢走步幅温和、贴地柔和；疾跑步幅拉满、抬脚更高更有弹性
    const strideX = lerp(9.5, 17.5, sprintBlend) * (0.45 + 0.55 * speedRatio);
    const liftY = lerp(4.2, 11.5, sprintBlend);
    const phaseF = f.runPhase;
    const phaseB = f.runPhase + Math.PI;

    const swingF = Math.sin(phaseF);
    const liftF = Math.max(0, Math.cos(phaseF));
    const swingB = Math.sin(phaseB);
    const liftB = Math.max(0, Math.cos(phaseB));

    const crouchSpread = isLanding ? f.landingStrength * 3.5 : 0;
    frontFootTarget = lerpVec(
      { x: hip.x + dir * (10.5 + crouchSpread), y: 0 },
      { x: hip.x + (swingF * strideX + 1.5) * dir, y: -liftF * liftY },
      gaitBlend
    );
    backFootTarget = lerpVec(
      { x: hip.x - dir * (9.5 + crouchSpread), y: 0 },
      { x: hip.x + (swingB * strideX - 1.5) * dir, y: -liftB * liftY },
      gaitBlend
    );
  }

  // 飞踢极限伸展时直接允许前脚超出自然步长，保留凌厉踢击剪影
  let frontLeg: { joint: Vec2; end: Vec2 };
  if (attack?.kind === 'kick' && atkRatio >= 0.24) {
    const dx = frontFootTarget.x - hip.x;
    const dy = frontFootTarget.y - hip.y;
    frontLeg = {
      joint: { x: hip.x + dx * 0.48, y: hip.y + dy * 0.48 - 1.5 },
      end: frontFootTarget,
    };
  } else {
    frontLeg = solveTwoBoneIK(hip, frontFootTarget, STICK_THIGH_LEN, STICK_SHIN_LEN, frontKneeBend);
  }
  const backLeg = solveTwoBoneIK(hip, backFootTarget, STICK_THIGH_LEN, STICK_SHIN_LEN, backKneeBend);

  // ===== 3. 手臂目标手掌坐标 + 2-Bone 手肘 IK + 武器角度 =====
  // 手肘默认向后下方弯曲（与膝盖相反）
  const elbowBend: -1 | 1 = dir === 1 ? 1 : -1;
  let backHandTarget: Vec2 = { x: shoulder.x - dir * 5, y: shoulder.y + 11 };
  let frontHandTarget: Vec2 = { x: shoulder.x + dir * 14, y: shoulder.y + 3 + idleWave * 1.1 };
  let weaponAngle = dir === 1 ? 0 : Math.PI;

  const isRangedWeapon =
    f.weapon !== null &&
    (f.weapon.kind === 'pistol' ||
      f.weapon.kind === 'shotgun' ||
      f.weapon.kind === 'rocket' ||
      f.weapon.kind === 'grenade');

  if (!f.alive || f.hitStunTimer > 0) {
    // 受击/击飞时双臂无力上扬甩开
    frontHandTarget = { x: shoulder.x + dir * 14, y: shoulder.y - 8 };
    backHandTarget = { x: shoulder.x - dir * 15, y: shoulder.y - 5 };
    if (f.weapon) weaponAngle = Math.atan2(f.aimY, f.aimX);
  } else if (isRangedWeapon && f.weapon) {
    weaponAngle = Math.atan2(f.aimY, f.aimX);
    const recoilPush = attack && atkRatio < 0.35 ? -Math.sin((atkRatio / 0.35) * Math.PI) * 5.5 : 0;
    const ux = Math.cos(weaponAngle);
    const uy = Math.sin(weaponAngle);
    const runBobY = lerp(idleWave * 0.6, Math.sin(f.runPhase * 2) * 1.4, gaitBlend);

    if (f.weapon.kind === 'grenade') {
      // 手雷投掷前蓄力拉臂 -> 甩手抛出
      if (attack?.kind === 'grenade' && atkRatio < 0.3) {
        frontHandTarget = { x: shoulder.x - dir * 12, y: shoulder.y - 9 };
        backHandTarget = { x: shoulder.x + dir * 11, y: shoulder.y + 4 };
      } else {
        frontHandTarget = { x: shoulder.x + ux * 17, y: shoulder.y + uy * 17 + runBobY };
        backHandTarget = { x: shoulder.x - dir * 8, y: shoulder.y + 9 + runBobY };
      }
    } else if (f.weapon.kind === 'rocket') {
      // 火箭筒扛肩双手稳托
      frontHandTarget = {
        x: shoulder.x + ux * (15 + recoilPush),
        y: shoulder.y + uy * (15 + recoilPush) - 2 + runBobY,
      };
      backHandTarget = {
        x: shoulder.x + ux * (7 + recoilPush * 0.5) - dir * 2,
        y: shoulder.y + uy * (7 + recoilPush * 0.5) + 1 + runBobY,
      };
    } else {
      // 手枪 / 猎枪双手持握瞄准
      frontHandTarget = {
        x: shoulder.x + ux * (18.5 + recoilPush),
        y: shoulder.y + uy * (18.5 + recoilPush) + runBobY,
      };
      backHandTarget = {
        x: shoulder.x + ux * (12 + recoilPush * 0.6),
        y: shoulder.y + uy * (12 + recoilPush * 0.6) + 2.5 + runBobY,
      };
    }
  } else if (attack?.kind === 'sword') {
    // 双手剑大弧度蓄力劈斩
    const startAng = dir === 1 ? -2.45 : Math.PI + 2.45;
    const endAng = dir === 1 ? 1.0 : Math.PI - 1.0;
    const swingT = clamp((atkRatio - 0.14) / 0.52, 0, 1);
    const eased = 1 - Math.pow(1 - swingT, 3);
    weaponAngle = lerp(startAng, endAng, eased);
    frontHandTarget = {
      x: shoulder.x + Math.cos(weaponAngle) * 19.5,
      y: shoulder.y + Math.sin(weaponAngle) * 19.5,
    };
    backHandTarget = {
      x: frontHandTarget.x - Math.cos(weaponAngle) * 3.5,
      y: frontHandTarget.y - Math.sin(weaponAngle) * 3.5 + 1.5,
    };
  } else if (attack?.kind === 'punch') {
    const ext = isActiveStrike
      ? 1
      : atkRatio < 0.24
      ? atkRatio / 0.24
      : Math.max(0, 1 - (atkRatio - 0.52) / 0.48);
    if (attack.comboStep === 2) {
      // 第 3 段升龙上勾拳
      frontHandTarget = {
        x: shoulder.x + dir * (11 + ext * 11),
        y: shoulder.y + 6 - ext * 22,
      };
      backHandTarget = { x: shoulder.x - dir * 10, y: shoulder.y + 9 };
    } else if (attack.comboStep === 1) {
      // 第 2 段重直拳（前臂直出、后臂猛拉蓄力）
      frontHandTarget = {
        x: shoulder.x + dir * (14 + ext * 19),
        y: shoulder.y + 1,
      };
      backHandTarget = { x: shoulder.x - dir * (8 + ext * 6), y: shoulder.y + 8 };
    } else {
      // 第 1 段快刺拳
      frontHandTarget = {
        x: shoulder.x + dir * (13 + ext * 17),
        y: shoulder.y - 1.5,
      };
      backHandTarget = { x: shoulder.x + dir * 4, y: shoulder.y + 6 };
    }
  } else if (attack?.kind === 'kick') {
    // 飞踢时双臂大幅展开反方向保持空中平衡
    frontHandTarget = { x: shoulder.x + dir * 12, y: shoulder.y + 9 };
    backHandTarget = { x: shoulder.x - dir * 15, y: shoulder.y - 4 };
  } else if (f.weapon?.kind === 'sword') {
    // 持剑武者姿态：奔跑时横剑后斜蓄势，空中提剑戒备，静止时斜前方警戒
    if (isTuckFlip) {
      weaponAngle = dir === 1 ? -1.8 : Math.PI + 1.8;
      frontHandTarget = { x: shoulder.x + dir * 9, y: shoulder.y + 5 };
      backHandTarget = { x: shoulder.x - dir * 4, y: shoulder.y + 8 };
    } else if (!f.onGround) {
      weaponAngle += dir * lerp(-0.35, -0.95, riseBlend);
      frontHandTarget = { x: shoulder.x + dir * 14, y: shoulder.y + lerp(4, -3, riseBlend) };
      backHandTarget = { x: shoulder.x - dir * 12, y: shoulder.y - lerp(1, 7, fallBlend) };
    } else {
      const carryBlend = smoothstep(0.25, 0.60, speedRatio);
      weaponAngle += dir * lerp(-0.55 + idleWave * 0.06, 0.42 + Math.sin(f.runPhase) * 0.14, carryBlend);
      frontHandTarget = lerpVec(
        { x: shoulder.x + dir * 14, y: shoulder.y + 4 + idleWave * 0.9 },
        { x: shoulder.x - dir * 7, y: shoulder.y + 10 },
        carryBlend
      );
      backHandTarget = lerpVec(
        { x: shoulder.x + dir * 6, y: shoulder.y + 8 + idleWave * 0.7 },
        { x: shoulder.x + dir * 13, y: shoulder.y + 5 },
        carryBlend
      );
    }
  } else if (isTuckFlip) {
    // 二段跳双臂抱膝团身
    frontHandTarget = { x: shoulder.x + dir * 9, y: shoulder.y + 10 };
    backHandTarget = { x: shoulder.x + dir * 4, y: shoulder.y + 12 };
  } else if (!f.onGround) {
    // 空中空手三阶段手臂：起跳上冲 -> 顶点展开平衡 -> 下坠迎风高举
    const riseF: Vec2 = { x: shoulder.x + dir * 12, y: shoulder.y - 10 };
    const riseB: Vec2 = { x: shoulder.x - dir * 13, y: shoulder.y + 6 };
    const apexF: Vec2 = { x: shoulder.x + dir * 15, y: shoulder.y - 2 };
    const apexB: Vec2 = { x: shoulder.x - dir * 14, y: shoulder.y - 3 };
    const fallF: Vec2 = { x: shoulder.x + dir * 12, y: shoulder.y - 11 };
    const fallB: Vec2 = { x: shoulder.x - dir * 13, y: shoulder.y - 12 };

    frontHandTarget = {
      x: riseF.x * riseBlend + apexF.x * apexBlend + fallF.x * fallBlend,
      y: riseF.y * riseBlend + apexF.y * apexBlend + fallF.y * fallBlend,
    };
    backHandTarget = {
      x: riseB.x * riseBlend + apexB.x * apexBlend + fallB.x * fallBlend,
      y: riseB.y * riseBlend + apexB.y * apexBlend + fallB.y * fallBlend,
    };
  } else if (isCrouching) {
    // 下蹲低架势护手
    frontHandTarget = { x: shoulder.x + dir * 13, y: shoulder.y + 5 + idleWave * 0.7 };
    backHandTarget = { x: shoulder.x + dir * 3, y: shoulder.y + 7.5 - idleWave * 0.5 };
  } else if (isSkidding) {
    // 急停双臂向外展开保持平衡
    frontHandTarget = { x: shoulder.x + dir * 14, y: shoulder.y + 2 };
    backHandTarget = { x: shoulder.x - dir * 15, y: shoulder.y - 3 };
  } else {
    // 与步态反向协调摆臂（左脚前则右手前），疾跑时摆臂更有力
    const armSwing = Math.sin(f.runPhase + Math.PI);
    const ampX = lerp(9, 15.5, sprintBlend);
    const liftFront = Math.max(0, armSwing) * lerp(3, 7, sprintBlend);
    const liftBack = Math.max(0, -armSwing) * lerp(3, 7, sprintBlend);

    const crouch = isLanding ? f.landingStrength : 0;
    const stanceFront = isLanding
      ? { x: shoulder.x + dir * (13 + crouch * 4), y: shoulder.y + 6 + crouch * 4 }
      : { x: shoulder.x + dir * (13.5 + idleWave * 1.1), y: shoulder.y + 1.5 - idleWave * 1.4 };
    const stanceBack = isLanding
      ? { x: shoulder.x - dir * (11 + crouch * 4), y: shoulder.y + 5 + crouch * 3 }
      : { x: shoulder.x + dir * (4.5 - idleWave * 0.9), y: shoulder.y + 5 + idleWave * 1.1 };
    frontHandTarget = lerpVec(
      stanceFront,
      { x: shoulder.x + (armSwing * ampX + 2) * dir, y: shoulder.y + 9 - liftFront },
      gaitBlend
    );
    backHandTarget = lerpVec(
      stanceBack,
      { x: shoulder.x - (armSwing * ampX + 1) * dir, y: shoulder.y + 9 - liftBack },
      gaitBlend
    );
  }

  // 出拳极限帧允许略微前送突出打击延展感，其余姿态严格走 2-Bone IK 保持臂长
  let frontArm: { joint: Vec2; end: Vec2 };
  if (attack?.kind === 'punch' && isActiveStrike) {
    frontArm = {
      joint: {
        x: lerp(shoulder.x, frontHandTarget.x, 0.48),
        y: lerp(shoulder.y, frontHandTarget.y, 0.48) + 1.4,
      },
      end: frontHandTarget,
    };
  } else {
    frontArm = solveTwoBoneIK(
      shoulder,
      frontHandTarget,
      STICK_UPPER_ARM_LEN,
      STICK_FOREARM_LEN,
      elbowBend
    );
  }
  const backArm = solveTwoBoneIK(
    shoulder,
    backHandTarget,
    STICK_UPPER_ARM_LEN,
    STICK_FOREARM_LEN,
    elbowBend
  );

  return {
    locomotion,
    hip,
    spineMid,
    shoulder,
    head,
    headTilt,
    backKnee: backLeg.joint,
    backFoot: backLeg.end,
    frontKnee: frontLeg.joint,
    frontFoot: frontLeg.end,
    backElbow: backArm.joint,
    backHand: backArm.end,
    frontElbow: frontArm.joint,
    frontHand: frontArm.end,
    poseScaleX,
    poseScaleY,
    weaponAngle,
    isActiveStrike,
  };
}

/**
 * 指数平滑姿态插值：消除待机/慢走/疾跑/起跳/落地之间的单帧跳变，
 * 同时在攻击/受击爆发帧使用极高响应速度确保格斗手感干脆利落。
 */
export function blendStickmanPose(
  prev: StickmanPose | undefined,
  target: StickmanPose,
  dtSeconds: number
): StickmanPose {
  if (!prev || dtSeconds <= 0) return target;
  const isSnappy =
    target.locomotion === 'attack' ||
    target.locomotion === 'hitstun' ||
    target.locomotion === 'double_jump_tuck' ||
    target.locomotion === 'ko';
  const rate = isSnappy
    ? 30
    : target.locomotion === 'jump_rise' || target.locomotion === 'crouch'
    ? 24
    : 17;
  const t = 1 - Math.exp(-rate * Math.min(0.05, dtSeconds));

  return {
    locomotion: target.locomotion,
    hip: lerpVec(prev.hip, target.hip, t),
    spineMid: lerpVec(prev.spineMid, target.spineMid, t),
    shoulder: lerpVec(prev.shoulder, target.shoulder, t),
    head: lerpVec(prev.head, target.head, t),
    headTilt: lerp(prev.headTilt, target.headTilt, t),
    backKnee: lerpVec(prev.backKnee, target.backKnee, t),
    backFoot: lerpVec(prev.backFoot, target.backFoot, t),
    frontKnee: lerpVec(prev.frontKnee, target.frontKnee, t),
    frontFoot: lerpVec(prev.frontFoot, target.frontFoot, t),
    backElbow: lerpVec(prev.backElbow, target.backElbow, t),
    backHand: lerpVec(prev.backHand, target.backHand, t),
    frontElbow: lerpVec(prev.frontElbow, target.frontElbow, t),
    frontHand: lerpVec(prev.frontHand, target.frontHand, t),
    poseScaleX: lerp(prev.poseScaleX, target.poseScaleX, t),
    poseScaleY: lerp(prev.poseScaleY, target.poseScaleY, t),
    weaponAngle: lerpAngle(prev.weaponAngle, target.weaponAngle, t),
    isActiveStrike: target.isActiveStrike,
  };
}
