const { Vec3 } = require('vec3');

function scanBlocks(bot, params = {}) {
  if (!bot || !bot.entity || !bot.entity.position) {
    throw new Error('Bot position is not available for block scanning');
  }

  const range = parseNumber(params.range, 32, { min: 1 });
  let filterTypes = params.types !== undefined ? params.types : params.type;
  if (typeof filterTypes === 'string') {
    filterTypes = [filterTypes];
  }
  if (Array.isArray(filterTypes) && filterTypes.length === 0) {
    filterTypes = null;
  }

  const rawMaxChecks = parseNumber(params.maxChecks, 25000);
  const limitEnabled = rawMaxChecks > 0 && Number.isFinite(rawMaxChecks);
  const maxChecks = limitEnabled ? rawMaxChecks : Infinity;
  const minYOffset = parseNumber(params.minYOffset, -range);
  const maxYOffset = parseNumber(params.maxYOffset, range);
  const yawDegrees = params.yaw !== undefined
    ? Number(params.yaw)
    : params.directionYaw !== undefined
      ? Number(params.directionYaw)
      : null;
  const coneAngleDegrees = params.coneAngle !== undefined ? Number(params.coneAngle) : null;
  const collectBlocks = params.collectBlocks !== false;
  const includeAir = params.includeAir === true;
  const onBlock = typeof params.onBlock === 'function' ? params.onBlock : null;

  if (maxYOffset < minYOffset) {
    throw new Error('maxYOffset must be greater than or equal to minYOffset');
  }

  let typeFilterSet = null;
  let normalizedFilterTypes = null;
  if (filterTypes) {
    typeFilterSet = new Set();
    normalizedFilterTypes = [];
    for (const typeName of filterTypes) {
      if (typeof typeName !== 'string') continue;
      const blockDef = bot.registry?.blocksByName?.[typeName];
      if (!blockDef) {
        throw new Error(`指定されたブロックタイプが見つかりません: ${typeName}`);
      }
      typeFilterSet.add(typeName);
      normalizedFilterTypes.push(typeName);
    }
    if (typeFilterSet.size === 0) {
      typeFilterSet = null;
      normalizedFilterTypes = null;
    }
  }

  const centerPos = bot.entity.position;
  const centerFloor = new Vec3(
    Math.floor(centerPos.x),
    Math.floor(centerPos.y),
    Math.floor(centerPos.z)
  );

  const gameMinY = typeof bot.game?.minY === 'number' ? bot.game.minY : centerFloor.y - range;
  const gameMaxY = typeof bot.game?.height === 'number'
    ? gameMinY + bot.game.height - 1
    : centerFloor.y + range;

  const minX = centerFloor.x - range;
  const maxX = centerFloor.x + range;
  const minY = Math.max(centerFloor.y + minYOffset, gameMinY);
  const maxY = Math.min(centerFloor.y + maxYOffset, gameMaxY);
  const minZ = centerFloor.z - range;
  const maxZ = centerFloor.z + range;

  const xOrder = buildAxisOrder(minX, maxX, centerFloor.x);
  const yOrder = buildAxisOrder(minY, maxY, centerFloor.y);
  const zOrder = buildAxisOrder(minZ, maxZ, centerFloor.z);

  const blocks = collectBlocks ? [] : null;
  const typeCounts = {};
  let checkedCount = 0;
  let eligibleTotal = 0;
  let limitReached = false;
  let farthestCheckedDistance = 0;

  const directionYawRad = yawDegrees !== null
    ? degreesToRadians(yawDegrees)
    : bot.entity?.yaw ?? 0;
  const coneHalfAngleRad = coneAngleDegrees !== null
    ? Math.max(0, degreesToRadians(coneAngleDegrees) / 2)
    : null;
  const forward2D = new Vec3(
    -Math.sin(directionYawRad),
    0,
    -Math.cos(directionYawRad)
  );
  const forwardLen = Math.hypot(forward2D.x, forward2D.z) || 1;
  forward2D.x /= forwardLen;
  forward2D.z /= forwardLen;

  let shouldStop = false;

  outer: for (const x of xOrder) {
    for (const y of yOrder) {
      for (const z of zOrder) {
        const pos = new Vec3(x, y, z);
        const distance = centerPos.distanceTo(pos);
        if (distance > range) continue;

        const offsetX = pos.x - centerFloor.x;
        const offsetZ = pos.z - centerFloor.z;
        if (coneHalfAngleRad !== null) {
          const horizontalDist = Math.hypot(offsetX, offsetZ);
          if (horizontalDist !== 0) {
            const dirX = offsetX / horizontalDist;
            const dirZ = offsetZ / horizontalDist;
            const dot = clampDot(forward2D.x * dirX + forward2D.z * dirZ);
            const angle = Math.acos(dot);
            if (angle > coneHalfAngleRad) continue;
          }
        }

        eligibleTotal++;
        if (checkedCount >= maxChecks) {
          limitReached = true;
          break outer;
        }

        checkedCount++;
        if (distance > farthestCheckedDistance) {
          farthestCheckedDistance = distance;
        }

        const block = bot.blockAt(pos, false);
        if (!block) continue;
        if (!includeAir && block.name.includes('air')) continue;
        if (typeFilterSet && !typeFilterSet.has(block.name)) continue;

        const distanceInt = Math.floor(distance);
        const relativePos = {
          x: offsetX,
          y: pos.y - centerFloor.y,
          z: offsetZ
        };

        if (collectBlocks) {
          blocks.push({
            name: block.name,
            position: { x: pos.x, y: pos.y, z: pos.z },
            relativePosition: relativePos,
            distance: distanceInt
          });
        }

        typeCounts[block.name] = (typeCounts[block.name] || 0) + 1;

        if (onBlock) {
          const callbackResult = onBlock({
            name: block.name,
            position: { x: pos.x, y: pos.y, z: pos.z },
            relativePosition: relativePos,
            distance: distanceInt,
            rawDistance: distance,
            block
          });
          if (callbackResult === true) {
            shouldStop = true;
            break outer;
          }
        }
      }
    }
  }

  if (collectBlocks) {
    blocks.sort((a, b) => a.distance - b.distance);
  }

  const estimatedEligible = estimateEligiblePositions(range, minYOffset, maxYOffset, coneAngleDegrees);
  const estimatedCoverage = estimatedEligible > 0 ? Math.min(checkedCount / estimatedEligible, 1) : 1;
  const estimatedCoveragePercent = Number((estimatedCoverage * 100).toFixed(2));
  const farthestDistance = Math.floor(farthestCheckedDistance);

  const summary = {
    totalBlocks: collectBlocks ? blocks.length : Object.values(typeCounts).reduce((sum, cnt) => sum + cnt, 0),
    uniqueTypes: Object.keys(typeCounts).length,
    typeCounts,
    checksUsed: checkedCount,
    maxChecks: limitEnabled ? rawMaxChecks : null,
    eligiblePositions: eligibleTotal,
    estimatedPositions: estimatedEligible,
    estimatedCoveragePercent,
    farthestDistance,
    scanRange: range,
    scanCenter: {
      x: centerFloor.x,
      y: centerFloor.y,
      z: centerFloor.z
    },
    minYOffset,
    maxYOffset,
    yaw: yawDegrees,
    coneAngle: coneAngleDegrees,
    limitReached,
    stoppedByCallback: shouldStop
  };

  const settings = {
    range,
    filterTypes: normalizedFilterTypes,
    maxChecks: limitEnabled ? rawMaxChecks : null,
    maxChecksLabel: limitEnabled ? rawMaxChecks : 'unlimited',
    limitEnabled,
    minYOffset,
    maxYOffset,
    yawDegrees,
    coneAngleDegrees
  };

  return {
    blocks: collectBlocks ? blocks : [],
    summary,
    settings
  };
}

module.exports = {
  scanBlocks
};

function parseNumber(value, fallback, { min = -Infinity, max = Infinity } = {}) {
  if (value === undefined || value === null) return fallback;
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  if (num < min) return min;
  if (num > max) return max;
  return num;
}

function buildAxisOrder(min, max, center) {
  const order = [];
  const lowerSteps = center - min;
  const upperSteps = max - center;

  if (center >= min && center <= max) {
    order.push(center);
  }

  const maxStep = Math.max(lowerSteps, upperSteps);
  for (let step = 1; step <= maxStep; step++) {
    const below = center - step;
    const above = center + step;

    if (below >= min) {
      order.push(below);
    }
    if (above <= max) {
      order.push(above);
    }
  }

  return order;
}

function degreesToRadians(deg) {
  return (deg * Math.PI) / 180;
}

function clampDot(value) {
  if (value > 1) return 1;
  if (value < -1) return -1;
  return value;
}

function estimateEligiblePositions(range, minYOffset, maxYOffset, coneAngleDegrees) {
  if (maxYOffset < minYOffset) return 0;

  const angle = coneAngleDegrees !== null ? Math.abs(coneAngleDegrees) : 360;
  const normalizedAngle = Math.min(angle % 360 || angle, 360);
  const coneFraction = normalizedAngle / 360;
  if (coneFraction === 0) return 0;

  const minY = Math.ceil(Math.max(-range, minYOffset));
  const maxY = Math.floor(Math.min(range, maxYOffset));
  if (maxY < minY) return 0;

  let total = 0;
  for (let y = minY; y <= maxY; y++) {
    const layerRadius = Math.sqrt(Math.max(range * range - y * y, 0));
    const intRadius = Math.floor(layerRadius);
    const area = Math.PI * intRadius * intRadius;
    total += Math.round(area * coneFraction);
  }
  return total;
}
