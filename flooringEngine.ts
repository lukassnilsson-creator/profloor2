
import { Point, PlankSettings, PlankInstance, WastePiece } from './types';
import { getBoundingBox, getWideRowSegments } from './geometry';

export interface LayoutResult {
  planks: PlankInstance[];
  wastePieces: WastePiece[];
  totalPlanksOpened: number;
}

export const calculateLayout = (
  roomPointsInput: Point[],
  settings: PlankSettings
): LayoutResult => {
  if (roomPointsInput.length < 3 || settings.width < 1 || settings.length < 1) {
    return { planks: [], wastePieces: [], totalPlanksOpened: 0 };
  }

  // Define expansion gap (standard 5mm as requested)
  const GAP = 5; // Force 5mm as per request
  const MIN_LAST_ROW_WIDTH = 30; // mm
  const SHIFT_COMPENSATION = 65; // mm

  // Determine laying direction from the selected origin corner.
  // If origin is on the right half → mirror X (lay right-to-left).
  // If origin is on the bottom half → mirror Y (lay bottom-to-top).
  const { minX: minXIn, maxX: maxXIn, minY: minYIn, maxY: maxYIn } = getBoundingBox(roomPointsInput);
  const originPointInput = roomPointsInput[settings.originPointIdx] || roomPointsInput[0];
  const mirrorX = originPointInput.x > (minXIn + maxXIn) / 2;
  const mirrorY = originPointInput.y > (minYIn + maxYIn) / 2;

  // Transform room points into canonical space where the origin is always near the top-left.
  // The algorithm always runs left-to-right, top-to-bottom in this canonical space.
  const roomPoints: Point[] = (mirrorX || mirrorY)
    ? roomPointsInput.map(p => ({
        x: mirrorX ? -p.x : p.x,
        y: mirrorY ? -p.y : p.y,
      }))
    : roomPointsInput;

  const { minY, maxY } = getBoundingBox(roomPoints);

  // Boundary with gap
  const effectiveMinY = minY + GAP;
  const effectiveMaxY = maxY - GAP;

  const originPoint = roomPoints[settings.originPointIdx] || roomPoints[0];
  const baseX = originPoint.x;
  const baseY = originPoint.y;

  const rowHeight = settings.width;
  const fullPlankLength = settings.length;
  const normalizedVerticalOffset =
    rowHeight > 0
      ? (((settings.startOffsetVertical || 0) % rowHeight) + rowHeight) % rowHeight
      : 0;

  interface PreparedSegment {
    start: number;
    end: number;
  }

  interface PreparedRow {
    rowIdx: number;
    actualRowTop: number;
    actualRowHeight: number;
    segments: PreparedSegment[];
  }

  interface CarryPlacement {
    x: number;
    y: number;
    h: number;
  }

  interface LayoutFlowState {
    carryOverOffcut: number;
    carryOverSourceId?: string;
    carryOverOffcutPlacement: CarryPlacement | null;
    lastRowJoints: number[];
    rowBeforeLastJoints: number[];
    alignmentBaseX: number;
  }

  interface TwoZoneOpeningPattern {
    splitAnchors: { rowIdx: number; leftZoneEnd: number; rightZoneStart: number }[];
    tolerance: number;
  }

  const createFlowState = (initialOffcut: number, alignmentBaseX: number): LayoutFlowState => ({
    carryOverOffcut: initialOffcut,
    carryOverSourceId: undefined,
    carryOverOffcutPlacement: null,
    lastRowJoints: [],
    rowBeforeLastJoints: [],
    alignmentBaseX
  });

  const clonePlacement = (placement: CarryPlacement | null): CarryPlacement | null =>
    placement ? { ...placement } : null;

  const commitRowState = (state: LayoutFlowState, currentRowJoints: number[]) => {
    state.rowBeforeLastJoints = state.lastRowJoints;
    state.lastRowJoints = currentRowJoints;
  };

  const getEffectiveMinStagger = (segmentLength: number) => {
    const standardStagger = settings.minStagger;
    const reducedStaggerFloor = Math.min(300, standardStagger);

    if (standardStagger <= reducedStaggerFloor || segmentLength >= 1000) {
      return standardStagger;
    }

    if (segmentLength <= 800) {
      return reducedStaggerFloor;
    }

    const progress = (segmentLength - 800) / 200;
    const interpolated = reducedStaggerFloor + ((standardStagger - reducedStaggerFloor) * progress);
    return Math.round(interpolated / 10) * 10;
  };

  const getVisualBackRowSpacing = (effectiveMinStagger: number) => {
    const visualFloor = Math.min(250, effectiveMinStagger);
    return Math.max(visualFloor, Math.round((effectiveMinStagger * 0.7) / 10) * 10);
  };

  const detectTwoZoneOpeningPattern = (rows: PreparedRow[]): TwoZoneOpeningPattern | null => {
    if (rows.length < 2) return null;

    const segmentCounts = rows.map((row) => row.segments.length);
    if (segmentCounts.some((count) => count > 2)) return null;

    const splitAnchors = rows
      .filter((row) => row.segments.length === 2)
      .map((row) => ({
        rowIdx: row.rowIdx,
        leftZoneEnd: row.segments[0].end,
        rightZoneStart: row.segments[1].start
      }));
    if (splitAnchors.length === 0) return null;

    const tolerance = Math.max(10, Math.min(25, rowHeight / 2));
    const validSplitAnchors = splitAnchors.every((anchor) => anchor.leftZoneEnd < anchor.rightZoneStart - 1);
    if (!validSplitAnchors) return null;

    const interpolateBoundary = (
      rowIdx: number,
      key: 'leftZoneEnd' | 'rightZoneStart'
    ): number => {
      const exactAnchor = splitAnchors.find((anchor) => anchor.rowIdx === rowIdx);
      if (exactAnchor) return exactAnchor[key];

      let prevAnchor: typeof splitAnchors[number] | null = null;
      let nextAnchor: typeof splitAnchors[number] | null = null;
      for (const anchor of splitAnchors) {
        if (anchor.rowIdx < rowIdx) {
          prevAnchor = anchor;
          continue;
        }
        if (anchor.rowIdx > rowIdx) {
          nextAnchor = anchor;
          break;
        }
      }

      if (prevAnchor && nextAnchor) {
        const progress = (rowIdx - prevAnchor.rowIdx) / (nextAnchor.rowIdx - prevAnchor.rowIdx);
        return prevAnchor[key] + ((nextAnchor[key] - prevAnchor[key]) * progress);
      }

      return (prevAnchor ?? nextAnchor)![key];
    };

    const classifySingleSegment = (
      rowIdx: number,
      segment: PreparedSegment
    ): 'left-only' | 'bridge' | 'right-only' | null => {
      const leftZoneEnd = interpolateBoundary(rowIdx, 'leftZoneEnd');
      const rightZoneStart = interpolateBoundary(rowIdx, 'rightZoneStart');
      if (segment.end <= leftZoneEnd + tolerance) return 'left-only';
      if (segment.start >= rightZoneStart - tolerance) return 'right-only';
      if (segment.start <= leftZoneEnd + tolerance && segment.end >= rightZoneStart - tolerance) return 'bridge';
      return null;
    };

    let bridgeRowCount = 0;
    for (const row of rows) {
      if (row.segments.length === 0) continue;
      if (row.segments.length === 2) continue;
      if (row.segments.length !== 1) return null;
      const classification = classifySingleSegment(row.rowIdx, row.segments[0]);
      if (!classification) return null;
      if (classification === 'bridge') bridgeRowCount++;
    }

    if (bridgeRowCount === 0) return null;

    return {
      splitAnchors,
      tolerance
    };
  };

  /**
   * Helper to perform layout with a specific vertical offset
   */
  const performLayout = (vOffset: number): LayoutResult => {
    const planks: PlankInstance[] = [];
    const wastePieces: WastePiece[] = [];
    let totalPlanksOpened = (settings.startOffset > 0) ? 1 : 0;

    const pushDiscardedOffcut = (
      width: number,
      sourcePlankId: string | undefined,
      placement: CarryPlacement | null,
      fallbackX: number,
      fallbackY: number,
      fallbackH: number
    ) => {
      if (width <= 0.5) return;
      wastePieces.push({
        x: placement ? placement.x : fallbackX,
        y: placement ? placement.y : fallbackY,
        w: width,
        h: placement ? placement.h : fallbackH,
        type: 'discarded-offcut',
        sourcePlankId
      });
    };

    const flushCarryOverOffcut = (
      state: LayoutFlowState,
      fallbackX: number,
      fallbackY: number,
      fallbackH: number
    ) => {
      pushDiscardedOffcut(
        state.carryOverOffcut,
        state.carryOverSourceId,
        state.carryOverOffcutPlacement,
        fallbackX,
        fallbackY,
        fallbackH
      );
      state.carryOverOffcut = 0;
      state.carryOverSourceId = undefined;
      state.carryOverOffcutPlacement = null;
    };

    const placeSegment = (
      row: PreparedRow,
      segment: PreparedSegment,
      segmentLabel: string,
      state: LayoutFlowState,
      hasClashPrev?: (jointX: number) => boolean,
      hasClashTwoRowsBack?: (jointX: number) => boolean
    ): number[] => {
      const segmentLength = segment.end - segment.start;
      if (segmentLength <= 0.1) return [];
      const localMinStagger = getEffectiveMinStagger(segmentLength);
      const localBackRowSpacing = getVisualBackRowSpacing(localMinStagger);

      const pushStartSideWaste = (width: number, type: WastePiece['type'], sourcePlankId?: string) => {
        if (width <= 0.5) return;
        wastePieces.push({
          x: segment.start - width,
          y: row.actualRowTop,
          w: width,
          h: row.actualRowHeight,
          type,
          sourcePlankId
        });
      };

      const clashPrev = hasClashPrev ?? ((jointX: number) =>
        state.lastRowJoints.some((lastJoint) => Math.abs(jointX - lastJoint) < localMinStagger)
      );
      const clashTwoRowsBack = hasClashTwoRowsBack ?? ((jointX: number) =>
        state.rowBeforeLastJoints.some((lastJoint) => Math.abs(jointX - lastJoint) < localBackRowSpacing)
      );

      const validateConfig = (startLengthToTest: number) => {
        if (startLengthToTest < settings.minEndPiece && Math.abs(startLengthToTest - fullPlankLength) > 0.1) {
          return false;
        }

        let currentJoint = segment.start + startLengthToTest;
        const testJoints: number[] = [];
        if (currentJoint < segment.end - 0.1) testJoints.push(currentJoint);
        while (currentJoint + fullPlankLength < segment.end - 0.1) {
          currentJoint += fullPlankLength;
          testJoints.push(currentJoint);
        }

        const finalPiece = segment.end - currentJoint;
        if (finalPiece < settings.minEndPiece && finalPiece > 0.1) return false;
        if (testJoints.some(clashPrev)) return false;
        if (testJoints.some(clashTwoRowsBack)) return false;
        return true;
      };

      if (!Number.isFinite(state.alignmentBaseX)) {
        state.alignmentBaseX = segment.start;
      }

      let startLength = 0;
      let startFromOffcut = false;
      let currentSourceId: string | undefined = undefined;
      let foundStart = false;
      let pendingStartCutWaste = 0;

      const distFromOrigin = segment.start - state.alignmentBaseX;
      let originAlignmentOffset = (fullPlankLength - (distFromOrigin % fullPlankLength)) % fullPlankLength;
      if (originAlignmentOffset < 0.1) originAlignmentOffset = fullPlankLength;

      if (state.carryOverOffcut >= settings.minEndPiece) {
        for (let testStart = state.carryOverOffcut; testStart >= settings.minEndPiece; testStart -= 5) {
          if (validateConfig(testStart)) {
            const extraCut = state.carryOverOffcut - testStart;
            const discardPlacement = state.carryOverOffcutPlacement
              ? {
                  x: state.carryOverOffcutPlacement.x,
                  y: state.carryOverOffcutPlacement.y,
                  h: state.carryOverOffcutPlacement.h
                }
              : null;
            pushDiscardedOffcut(
              extraCut,
              state.carryOverSourceId,
              discardPlacement,
              segment.start - extraCut,
              row.actualRowTop,
              row.actualRowHeight
            );
            startLength = testStart;
            startFromOffcut = true;
            currentSourceId = state.carryOverSourceId;
            state.carryOverOffcut = 0;
            state.carryOverSourceId = undefined;
            state.carryOverOffcutPlacement = null;
            foundStart = true;
            break;
          }
        }
      }

      if (!foundStart) {
        flushCarryOverOffcut(
          state,
          segment.start - state.carryOverOffcut,
          row.actualRowTop,
          row.actualRowHeight
        );
        totalPlanksOpened++;

        if (validateConfig(fullPlankLength)) {
          startLength = fullPlankLength;
          foundStart = true;
        } else if (originAlignmentOffset >= settings.minEndPiece && validateConfig(originAlignmentOffset)) {
          startLength = originAlignmentOffset;
          foundStart = true;
        } else {
          for (let testStart = fullPlankLength; testStart >= settings.minEndPiece; testStart -= 5) {
            if (validateConfig(testStart)) {
              const extraCut = fullPlankLength - testStart;
              if (extraCut > 0.5) {
                pendingStartCutWaste = extraCut;
              }
              startLength = testStart;
              foundStart = true;
              break;
            }
          }
        }
      }

      if (!foundStart) {
        startLength = settings.minEndPiece;
        startFromOffcut = false;
      }

      const segmentJoints: number[] = [];
      let curX = segment.start;
      let isFirstInSegment = true;
      let safetyPlanks = 0;

      while (curX < segment.end - 0.1 && safetyPlanks < 1000) {
        safetyPlanks++;
        const plankLength = isFirstInSegment
          ? Math.min(startLength, segment.end - curX)
          : Math.min(fullPlankLength, segment.end - curX);
        const plankId = `r${row.rowIdx}-${segmentLabel}-p${safetyPlanks}`;

        if (!isFirstInSegment) totalPlanksOpened++;

        const isLastInSegment = (curX + plankLength >= segment.end - 0.1);
        const isReusedOffcut = isFirstInSegment && startFromOffcut;

        planks.push({
          id: plankId,
          x: curX,
          y: row.actualRowTop,
          w: plankLength,
          h: row.actualRowHeight,
          row: row.rowIdx,
          isCut: !(Math.abs(plankLength - fullPlankLength) < 0.5 && !isReusedOffcut),
          fullWidth: rowHeight,
          fullLength: fullPlankLength,
          visualX: curX,
          isFromOffcut: isReusedOffcut,
          sourcePlankId: isFirstInSegment ? currentSourceId : undefined
        });

        if (isFirstInSegment && pendingStartCutWaste > 0.5) {
          pushStartSideWaste(pendingStartCutWaste, 'start-cut', plankId);
          pendingStartCutWaste = 0;
        }

        if (isLastInSegment) {
          state.carryOverOffcut = fullPlankLength - plankLength;
          state.carryOverSourceId = plankId;
          state.carryOverOffcutPlacement =
            state.carryOverOffcut > 0.5
              ? { x: curX + plankLength, y: row.actualRowTop, h: row.actualRowHeight }
              : null;
        } else {
          segmentJoints.push(curX + plankLength);
        }

        curX += plankLength;
        isFirstInSegment = false;
      }

      return segmentJoints;
    };

    // Calculate row alignment based on origin point and compensation shift
    const alignmentY = baseY - vOffset;

    // Find the very first row top that could possibly intersect the room
    const firstRowTop = alignmentY - Math.ceil((alignmentY - effectiveMinY) / rowHeight) * rowHeight;

    const rowTops: number[] = [];
    let currentY = firstRowTop;
    while (currentY < effectiveMaxY) {
      // Ensure we only include rows that actually have some part within the effective area
      if (currentY + rowHeight > effectiveMinY) {
        rowTops.push(currentY);
      }
      currentY += rowHeight;
    }

    if (rowTops.length === 0) return { planks: [], wastePieces: [], totalPlanksOpened: 0 };

    // Check if the last row is too narrow
    const lastRowTop = rowTops[rowTops.length - 1];
    const lastRowVisibleHeight = effectiveMaxY - lastRowTop;

    // If last row is a sliver and we haven't shifted yet, shift the entire floor up
    if (vOffset === 0 && lastRowVisibleHeight < MIN_LAST_ROW_WIDTH) {
      return performLayout(SHIFT_COMPENSATION);
    }

    const preparedRows: PreparedRow[] = rowTops.map((rowTop, rowIdx) => {
      const actualRowTop = Math.max(rowTop, effectiveMinY);
      const actualRowBottom = Math.min(rowTop + rowHeight, effectiveMaxY);
      const actualRowHeight = actualRowBottom - actualRowTop;
      const segments = actualRowHeight < 0.1
        ? []
        : getWideRowSegments(actualRowTop, actualRowBottom, roomPoints)
            .map((segment) => ({ start: segment.start + GAP, end: segment.end - GAP }))
            .filter((segment) => segment.end - segment.start > 0.1);

      return {
        rowIdx,
        actualRowTop,
        actualRowHeight,
        segments
      };
    });

    const twoZonePattern = detectTwoZoneOpeningPattern(preparedRows);

    if (twoZonePattern) {
      const leftState = createFlowState((settings.startOffset) % settings.length, baseX);
      const rightState = createFlowState(0, Number.NaN);
      const interpolateBoundary = (
        rowIdx: number,
        key: 'leftZoneEnd' | 'rightZoneStart'
      ): number => {
        const exactAnchor = twoZonePattern.splitAnchors.find((anchor) => anchor.rowIdx === rowIdx);
        if (exactAnchor) return exactAnchor[key];

        let prevAnchor: typeof twoZonePattern.splitAnchors[number] | null = null;
        let nextAnchor: typeof twoZonePattern.splitAnchors[number] | null = null;
        for (const anchor of twoZonePattern.splitAnchors) {
          if (anchor.rowIdx < rowIdx) {
            prevAnchor = anchor;
            continue;
          }
          if (anchor.rowIdx > rowIdx) {
            nextAnchor = anchor;
            break;
          }
        }

        if (prevAnchor && nextAnchor) {
          const progress = (rowIdx - prevAnchor.rowIdx) / (nextAnchor.rowIdx - prevAnchor.rowIdx);
          return prevAnchor[key] + ((nextAnchor[key] - prevAnchor[key]) * progress);
        }

        return (prevAnchor ?? nextAnchor)![key];
      };

      const getRowBoundaries = (rowIdx: number) => ({
        leftZoneEnd: interpolateBoundary(rowIdx, 'leftZoneEnd'),
        rightZoneStart: interpolateBoundary(rowIdx, 'rightZoneStart')
      });

      const classifySingleSegment = (
        rowIdx: number,
        segment: PreparedSegment
      ): 'left-only' | 'bridge' | 'right-only' | null => {
        const { leftZoneEnd, rightZoneStart } = getRowBoundaries(rowIdx);
        if (segment.end <= leftZoneEnd + twoZonePattern.tolerance) return 'left-only';
        if (segment.start >= rightZoneStart - twoZonePattern.tolerance) return 'right-only';
        if (
          segment.start <= leftZoneEnd + twoZonePattern.tolerance &&
          segment.end >= rightZoneStart - twoZonePattern.tolerance
        ) {
          return 'bridge';
        }
        return null;
      };

      preparedRows.forEach((row) => {
        if (row.actualRowHeight < 0.1) return;

        if (row.segments.length === 2) {
          const leftRowJoints = placeSegment(row, row.segments[0], 'left', leftState);
          const rightRowJoints = placeSegment(row, row.segments[1], 'right', rightState);
          commitRowState(leftState, leftRowJoints);
          commitRowState(rightState, rightRowJoints);
          return;
        }

        if (row.segments.length !== 1) {
          commitRowState(leftState, []);
          commitRowState(rightState, []);
          return;
        }

        const singleSegmentType = classifySingleSegment(row.rowIdx, row.segments[0]);
        if (singleSegmentType === 'left-only') {
          const leftRowJoints = placeSegment(row, row.segments[0], 'leftsolo', leftState);
          commitRowState(leftState, leftRowJoints);
          commitRowState(rightState, []);
          return;
        }

        if (singleSegmentType === 'right-only') {
          const rightRowJoints = placeSegment(row, row.segments[0], 'rightsolo', rightState);
          commitRowState(leftState, []);
          commitRowState(rightState, rightRowJoints);
          return;
        }

        if (singleSegmentType !== 'bridge') {
          commitRowState(leftState, []);
          commitRowState(rightState, []);
          return;
        }

        const bridgeState: LayoutFlowState = {
          carryOverOffcut: leftState.carryOverOffcut,
          carryOverSourceId: leftState.carryOverSourceId,
          carryOverOffcutPlacement: clonePlacement(leftState.carryOverOffcutPlacement),
          lastRowJoints: leftState.lastRowJoints,
          rowBeforeLastJoints: leftState.rowBeforeLastJoints,
          alignmentBaseX: leftState.alignmentBaseX
        };

        const { leftZoneEnd, rightZoneStart } = getRowBoundaries(row.rowIdx);
        const inLeftZone = (jointX: number) => jointX <= leftZoneEnd + twoZonePattern.tolerance;
        const inRightZone = (jointX: number) => jointX >= rightZoneStart - twoZonePattern.tolerance;
        const bridgeMinStagger = getEffectiveMinStagger(row.segments[0].end - row.segments[0].start);
        const bridgeBackRowSpacing = getVisualBackRowSpacing(bridgeMinStagger);

        const bridgeRowJoints = placeSegment(
          row,
          row.segments[0],
          'bridge',
          bridgeState,
          (jointX) =>
            (inLeftZone(jointX) && leftState.lastRowJoints.some((lastJoint) => Math.abs(jointX - lastJoint) < bridgeMinStagger)) ||
            (inRightZone(jointX) && rightState.lastRowJoints.some((lastJoint) => Math.abs(jointX - lastJoint) < bridgeMinStagger)),
          (jointX) =>
            (inLeftZone(jointX) && leftState.rowBeforeLastJoints.some((lastJoint) => Math.abs(jointX - lastJoint) < bridgeBackRowSpacing)) ||
            (inRightZone(jointX) && rightState.rowBeforeLastJoints.some((lastJoint) => Math.abs(jointX - lastJoint) < bridgeBackRowSpacing))
        );

        const leftBridgeJoints = bridgeRowJoints.filter(inLeftZone);
        const rightBridgeJoints = bridgeRowJoints.filter(inRightZone);

        leftState.carryOverOffcut = 0;
        leftState.carryOverSourceId = undefined;
        leftState.carryOverOffcutPlacement = null;
        rightState.carryOverOffcut = bridgeState.carryOverOffcut;
        rightState.carryOverSourceId = bridgeState.carryOverSourceId;
        rightState.carryOverOffcutPlacement = clonePlacement(bridgeState.carryOverOffcutPlacement);

        commitRowState(leftState, leftBridgeJoints);
        commitRowState(rightState, rightBridgeJoints);
      });

      flushCarryOverOffcut(leftState, baseX, effectiveMaxY - rowHeight, rowHeight);
      flushCarryOverOffcut(rightState, baseX, effectiveMaxY - rowHeight, rowHeight);
    } else {
      const globalState = createFlowState((settings.startOffset) % settings.length, baseX);

      preparedRows.forEach((row) => {
        if (row.actualRowHeight < 0.1) return;

        const currentRowJoints: number[] = [];
        row.segments.forEach((segment, segmentIdx) => {
          currentRowJoints.push(...placeSegment(row, segment, `s${segmentIdx}`, globalState));
        });
        commitRowState(globalState, currentRowJoints);
      });

      flushCarryOverOffcut(globalState, baseX, effectiveMaxY - rowHeight, rowHeight);
    }

    return { planks, wastePieces, totalPlanksOpened };
  };

  const rawResult = performLayout(normalizedVerticalOffset);

  // If no mirroring was applied, return directly
  if (!mirrorX && !mirrorY) return rawResult;

  // Transform plank and waste coordinates back to the original coordinate space
  const mirrorPlank = (p: PlankInstance): PlankInstance => ({
    ...p,
    x: mirrorX ? -(p.x + p.w) : p.x,
    y: mirrorY ? -(p.y + p.h) : p.y,
    visualX: mirrorX ? -(p.visualX + p.w) : p.visualX,
  });

  const mirrorWaste = (w: WastePiece): WastePiece => ({
    ...w,
    x: mirrorX ? -(w.x + w.w) : w.x,
    y: mirrorY ? -(w.y + w.h) : w.y,
  });

  return {
    totalPlanksOpened: rawResult.totalPlanksOpened,
    planks: rawResult.planks.map(mirrorPlank),
    wastePieces: rawResult.wastePieces.map(mirrorWaste),
  };
};
