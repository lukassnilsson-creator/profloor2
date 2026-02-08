
import { Point, PlankSettings, PlankInstance, WastePiece } from './types';
import { getBoundingBox, getWideRowSegments } from './geometry';

export interface LayoutResult {
  planks: PlankInstance[];
  wastePieces: WastePiece[];
  totalPlanksOpened: number;
}

export const calculateLayout = (
  roomPoints: Point[],
  settings: PlankSettings
): LayoutResult => {
  if (roomPoints.length < 3 || settings.width < 1 || settings.length < 1) {
    return { planks: [], wastePieces: [], totalPlanksOpened: 0 };
  }

  // Define expansion gap (standard 5mm as requested)
  const GAP = 5; // Force 5mm as per request
  const MIN_LAST_ROW_WIDTH = 30; // mm
  const SHIFT_COMPENSATION = 65; // mm

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

  /**
   * Helper to perform layout with a specific vertical offset
   */
  const performLayout = (vOffset: number): LayoutResult => {
    const planks: PlankInstance[] = [];
    const wastePieces: WastePiece[] = [];
    
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

    let carryOverOffcut = (settings.startOffset) % settings.length; 
    let carryOverSourceId: string | undefined = undefined; 
    let lastRowJoints: number[] = []; 
    let rowBeforeLastJoints: number[] = []; 
    let totalPlanksOpened = (settings.startOffset > 0) ? 1 : 0;

    rowTops.forEach((rowTop, rowIdx) => {
      // The row might be partially outside at the top or bottom
      const actualRowTop = Math.max(rowTop, effectiveMinY);
      const actualRowBottom = Math.min(rowTop + rowHeight, effectiveMaxY);
      const actualRowHeight = actualRowBottom - actualRowTop;
      
      if (actualRowHeight < 0.1) return;

      const segments = getWideRowSegments(actualRowTop, actualRowBottom, roomPoints);
      const currentRowJoints: number[] = [];

      segments.forEach((segment) => {
        // Apply horizontal gap
        const segStart = segment.start + GAP;
        const segEnd = segment.end - GAP;
        const segmentWidth = segEnd - segStart;
        if (segmentWidth <= 0.1) return;

        const validateConfig = (sLen: number) => {
          if (sLen < settings.minEndPiece && Math.abs(sLen - fullPlankLength) > 0.1) return false;
          let currentJoint = segStart + sLen;
          const testJoints = [];
          if (currentJoint < segEnd - 0.1) testJoints.push(currentJoint);
          while (currentJoint + fullPlankLength < segEnd - 0.1) {
            currentJoint += fullPlankLength;
            testJoints.push(currentJoint);
          }
          const finalPiece = segEnd - currentJoint;
          if (finalPiece < settings.minEndPiece && finalPiece > 0.1) return false;

          const hasClashPrev = testJoints.some(tj => 
            lastRowJoints.some(lj => Math.abs(tj - lj) < settings.minStagger)
          );
          if (hasClashPrev) return false;

          const hasClashTwoRowsBack = testJoints.some(tj => 
            rowBeforeLastJoints.some(lj => Math.abs(tj - lj) < (settings.minStagger / 2))
          );
          if (hasClashTwoRowsBack) return false;

          return true;
        };

        let startLength = 0;
        let startFromOffcut = false;
        let currentSourceId: string | undefined = undefined;
        let foundStart = false;

        // Origin Alignment: How many full planks from baseX to segment start?
        const distFromOrigin = segStart - baseX;
        let originAlignmentOffset = (fullPlankLength - (distFromOrigin % fullPlankLength)) % fullPlankLength;
        if (originAlignmentOffset < 0.1) originAlignmentOffset = fullPlankLength;

        // 1. Try offcut
        if (carryOverOffcut >= settings.minEndPiece) {
          for (let testS = carryOverOffcut; testS >= settings.minEndPiece; testS -= 5) {
            if (validateConfig(testS)) {
              const extraCut = carryOverOffcut - testS;
              if (extraCut > 0.5) {
                wastePieces.push({
                  x: segStart - extraCut, y: actualRowTop, w: extraCut, h: actualRowHeight, type: 'start-cut'
                });
              }
              startLength = testS;
              startFromOffcut = true;
              currentSourceId = carryOverSourceId;
              foundStart = true;
              break;
            }
          }
        }

        // 2. Try Origin alignment
        if (!foundStart) {
          if (carryOverOffcut > 0.5) {
            wastePieces.push({
              x: segStart - carryOverOffcut, y: actualRowTop, w: carryOverOffcut, h: actualRowHeight, type: 'discarded-offcut'
            });
          }
          totalPlanksOpened++;
          
          if (originAlignmentOffset >= settings.minEndPiece && validateConfig(originAlignmentOffset)) {
            startLength = originAlignmentOffset;
            foundStart = true;
          } else if (validateConfig(fullPlankLength)) {
            startLength = fullPlankLength;
            foundStart = true;
          } else {
            for (let testS = fullPlankLength; testS >= settings.minEndPiece; testS -= 5) {
              if (validateConfig(testS)) {
                const extraCut = fullPlankLength - testS;
                if (extraCut > 0.5) {
                  wastePieces.push({
                    x: segStart - extraCut, y: actualRowTop, w: extraCut, h: actualRowHeight, type: 'start-cut'
                  });
                }
                startLength = testS;
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

        let curX = segStart;
        let isFirstInSegment = true;
        let safetyPlanks = 0;
        
        while (curX < segEnd - 0.1 && safetyPlanks < 1000) {
          safetyPlanks++;
          const pLen = isFirstInSegment ? Math.min(startLength, segEnd - curX) : Math.min(fullPlankLength, segEnd - curX);
          const plankId = `r${rowIdx}-s${segments.indexOf(segment)}-p${safetyPlanks}`;
          
          if (!isFirstInSegment) totalPlanksOpened++;

          const isLastInSegment = (curX + pLen >= segEnd - 0.1);
          const isReusedOffcut = isFirstInSegment && startFromOffcut;

          planks.push({
            id: plankId,
            x: curX,
            y: actualRowTop,
            w: pLen,
            h: actualRowHeight,
            row: rowIdx,
            isCut: !(Math.abs(pLen - fullPlankLength) < 0.5 && !isReusedOffcut),
            fullWidth: rowHeight,
            fullLength: fullPlankLength,
            visualX: curX,
            isFromOffcut: isReusedOffcut,
            sourcePlankId: isFirstInSegment ? currentSourceId : undefined
          });

          if (isLastInSegment) {
            carryOverOffcut = fullPlankLength - pLen;
            carryOverSourceId = plankId;
          } else {
            currentRowJoints.push(curX + pLen);
          }

          curX += pLen;
          isFirstInSegment = false;
        }
      });

      rowBeforeLastJoints = lastRowJoints;
      lastRowJoints = currentRowJoints;
    });

    return { planks, wastePieces, totalPlanksOpened };
  };

  return performLayout(normalizedVerticalOffset);
};
