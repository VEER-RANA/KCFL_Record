import jsPDF from 'jspdf';
import type { GameSnapshot } from './types';

export async function generateGameReportPDF(
  gameName: string,
  gameCode: string,
  game: GameSnapshot,
  _tableElement: HTMLElement | null,
  _rankingElement: HTMLElement | null
) {
  try {
    const pdf = new jsPDF({
      orientation: 'landscape',
      unit: 'mm',
      format: 'a4'
    });

    const pageWidth = pdf.internal.pageSize.getWidth();
    const pageHeight = pdf.internal.pageSize.getHeight();
    const margin = 10;
    const contentWidth = pageWidth - margin * 2;
    const bottomLimit = pageHeight - 12;
    let currentY = 14;

    const drawPageFrame = () => {
      pdf.setDrawColor(210, 210, 210);
      pdf.rect(margin - 3, 6, contentWidth + 6, pageHeight - 12);
    };

    const drawMainHeader = () => {
      drawPageFrame();
      pdf.setFont('helvetica', 'bold');
      pdf.setFontSize(18);
      pdf.setTextColor(33, 33, 33);
      pdf.text('Game Report', margin, currentY);

      pdf.setFont('helvetica', 'normal');
      pdf.setFontSize(10);
      pdf.text(`Generated: ${new Date().toLocaleString()}`, pageWidth - margin, currentY, { align: 'right' });
      currentY += 8;

      pdf.setDrawColor(180, 180, 180);
      pdf.line(margin, currentY, pageWidth - margin, currentY);
      currentY += 6;
    };

    const drawSectionTitle = (title: string) => {
      pdf.setFont('helvetica', 'bold');
      pdf.setFontSize(13);
      pdf.setTextColor(45, 45, 45);
      pdf.text(title, margin, currentY);
      currentY += 6;
    };

    const ensureSpace = (heightNeeded: number, repeatTitle?: string, drawHeaderRow?: () => void) => {
      if (currentY + heightNeeded <= bottomLimit) {
        return;
      }

      pdf.addPage();
      currentY = 14;
      drawPageFrame();

      if (repeatTitle) {
        drawSectionTitle(repeatTitle);
        if (drawHeaderRow) {
          drawHeaderRow();
        }
      }
    };

    const cellText = (value: string, x: number, y: number, w: number, align: 'left' | 'center' | 'right' = 'left') => {
      const horizontalPadding = 2;
      const maxWidth = Math.max(2, w - horizontalPadding * 2);
      const clipped = pdf.splitTextToSize(value, maxWidth)[0] ?? '';

      if (align === 'right') {
        pdf.text(clipped, x + w - horizontalPadding, y, { align: 'right' });
        return;
      }

      if (align === 'center') {
        pdf.text(clipped, x + w / 2, y, { align: 'center' });
        return;
      }

      pdf.text(clipped, x + horizontalPadding, y);
    };

    const normalizeCardLabel = (label: string) => {
      const collapsedSpacedLetters = label.replace(/\b(?:[A-Za-z]\s+){2,}[A-Za-z]\b/g, (match) => match.replace(/\s+/g, ''));

      return collapsedSpacedLetters
        .replace(/&[a-z0-9#]+;/gi, ' ')
        .replace(/[`~^|\\/]+/g, ' ')
        .replace(/[♠♦♣♥]/g, '')
        .replace(/\s+/g, ' ')
        .trim();
    };

    const compactCardLabel = (distributionRow: GameSnapshot['distribution'][number]) => {
      const source = distributionRow.cardsByPlayer[0]?.cardLabel ?? distributionRow.label;
      const cleaned = normalizeCardLabel(source);

      const cardMatch = cleaned.match(/^(\d+)\s+(Without\s+Sir|Without|Spades?|Diamonds?|Clubs?|Hearts?)/i);
      if (cardMatch) {
        const value = cardMatch[1];
        const suit = cardMatch[2].replace(/\s+/g, ' ');
        return `${value} ${suit}`;
      }

      return cleaned.length > 18 ? `${cleaned.slice(0, 17)}.` : cleaned;
    };

    const drawSummary = () => {
      drawSectionTitle('Game Summary');

      const boxHeight = 22;
      ensureSpace(boxHeight + 2);

      pdf.setFillColor(248, 248, 248);
      pdf.setDrawColor(212, 212, 212);
      pdf.roundedRect(margin, currentY, contentWidth, boxHeight, 2, 2, 'FD');

      const colWidth = contentWidth / 4;
      const summaryEntries = [
        ['Game Name', gameName],
        ['Game Code', gameCode],
        ['Status', game.status.toUpperCase()],
        ['Players', String(game.players.length)]
      ];

      pdf.setFont('helvetica', 'bold');
      pdf.setFontSize(9);
      pdf.setTextColor(90, 90, 90);

      summaryEntries.forEach(([label], index) => {
        const x = margin + index * colWidth;
        cellText(label, x, currentY + 6, colWidth);
      });

      pdf.setFont('helvetica', 'normal');
      pdf.setFontSize(11);
      pdf.setTextColor(20, 20, 20);

      summaryEntries.forEach(([, value], index) => {
        const x = margin + index * colWidth;
        cellText(value, x, currentY + 15, colWidth);
      });

      currentY += boxHeight + 8;
    };

    const rankingData = game.ranking.length
      ? game.ranking
      : [...game.players]
          .sort((a, b) => b.totalScore - a.totalScore)
          .map((player) => ({
            playerId: player.id,
            playerName: player.name,
            totalScore: player.totalScore
          }));

    const drawLeaderboard = () => {
      drawSectionTitle('Leaderboard');

      const columns = [
        { title: 'Rank', width: 20, align: 'center' as const },
        { title: 'Player', width: contentWidth - 55, align: 'left' as const },
        { title: 'Total Score', width: 35, align: 'right' as const }
      ];

      const rowHeight = 7;

      const drawHeaderRow = () => {
        pdf.setFillColor(232, 236, 245);
        pdf.setDrawColor(190, 196, 208);
        pdf.rect(margin, currentY, contentWidth, rowHeight, 'FD');

        pdf.setFont('helvetica', 'bold');
        pdf.setFontSize(9);
        pdf.setTextColor(30, 30, 30);

        let x = margin;
        columns.forEach((column) => {
          pdf.rect(x, currentY, column.width, rowHeight);
          cellText(column.title, x, currentY + 4.8, column.width, column.align);
          x += column.width;
        });

        currentY += rowHeight;
      };

      ensureSpace(rowHeight + 2);
      drawHeaderRow();

      pdf.setFont('helvetica', 'normal');
      pdf.setFontSize(9);

      rankingData.forEach((entry, index) => {
        ensureSpace(rowHeight, 'Leaderboard', drawHeaderRow);

        const fill = index % 2 === 0 ? 253 : 248;
        pdf.setFillColor(fill, fill, fill);
        pdf.setDrawColor(220, 220, 220);
        pdf.rect(margin, currentY, contentWidth, rowHeight, 'FD');

        let x = margin;
        const rowValues = [
          String(index + 1),
          entry.playerName,
          String(entry.totalScore)
        ];

        columns.forEach((column, columnIndex) => {
          pdf.rect(x, currentY, column.width, rowHeight);
          cellText(rowValues[columnIndex], x, currentY + 4.8, column.width, column.align);
          x += column.width;
        });

        currentY += rowHeight;
      });

      currentY += 8;
    };

    const drawBidTable = () => {
      const minPlayerColumnWidth = 20;
      const maxPlayerColumnWidth = 38;
      const roundColumnWidth = 14;
      const cardColumnWidth = 34;
      const fixedWidth = roundColumnWidth + cardColumnWidth;
      const maxPlayersPerChunk = Math.max(1, Math.floor((contentWidth - fixedWidth) / minPlayerColumnWidth));

      const playerChunks: Array<typeof game.players> = [];
      for (let index = 0; index < game.players.length; index += maxPlayersPerChunk) {
        playerChunks.push(game.players.slice(index, index + maxPlayersPerChunk));
      }

      const rounds = [...game.distribution].sort((a, b) => a.round - b.round);

      playerChunks.forEach((chunk, chunkIndex) => {
        drawSectionTitle(
          playerChunks.length > 1
            ? `Bid Table (Players ${chunkIndex * maxPlayersPerChunk + 1}-${chunkIndex * maxPlayersPerChunk + chunk.length})`
            : 'Bid Table'
        );

        const availablePlayerWidth = contentWidth - fixedWidth;
        const playerColumnWidth = Math.max(
          minPlayerColumnWidth,
          Math.min(maxPlayerColumnWidth, availablePlayerWidth / chunk.length)
        );
        const rowHeight = 8;
        const chunkWidth = fixedWidth + chunk.length * playerColumnWidth;
        const chunkStartX = margin + (contentWidth - chunkWidth) / 2;

        const drawHeaderRow = () => {
          pdf.setFillColor(232, 236, 245);
          pdf.setDrawColor(190, 196, 208);
          pdf.rect(chunkStartX, currentY, chunkWidth, rowHeight, 'FD');

          pdf.setFont('helvetica', 'bold');
          pdf.setFontSize(8.5);
          pdf.setTextColor(30, 30, 30);

          let x = chunkStartX;
          pdf.rect(x, currentY, roundColumnWidth, rowHeight);
          cellText('Rnd', x, currentY + 5.2, roundColumnWidth, 'center');
          x += roundColumnWidth;

          pdf.rect(x, currentY, cardColumnWidth, rowHeight);
          cellText('Card', x, currentY + 5.2, cardColumnWidth, 'center');
          x += cardColumnWidth;

          chunk.forEach((player) => {
            pdf.rect(x, currentY, playerColumnWidth, rowHeight);
            const shortName = player.name.length > 9 ? `${player.name.slice(0, 8)}.` : player.name;
            cellText(shortName, x, currentY + 5.2, playerColumnWidth, 'center');
            x += playerColumnWidth;
          });

          currentY += rowHeight;
        };

        ensureSpace(rowHeight + 2);
        drawHeaderRow();

        pdf.setFont('helvetica', 'normal');
        pdf.setFontSize(8.5);

        rounds.forEach((distributionRow, rowIndex) => {
          ensureSpace(rowHeight, 'Bid Table', drawHeaderRow);

          const fill = rowIndex % 2 === 0 ? 253 : 248;
          pdf.setFillColor(fill, fill, fill);
          pdf.setDrawColor(220, 220, 220);
          pdf.rect(chunkStartX, currentY, chunkWidth, rowHeight, 'FD');

          let x = chunkStartX;
          pdf.rect(x, currentY, roundColumnWidth, rowHeight);
          cellText(String(distributionRow.round), x, currentY + 5.2, roundColumnWidth, 'center');
          x += roundColumnWidth;

          pdf.rect(x, currentY, cardColumnWidth, rowHeight);
          const cardText = compactCardLabel(distributionRow);
          cellText(cardText, x, currentY + 5.2, cardColumnWidth, 'center');
          x += cardColumnWidth;

          chunk.forEach((player) => {
            const bidCell = game.bids[distributionRow.round]?.[player.id];
            const bidText = bidCell
              ? `${bidCell.bid}${bidCell.completed ? ' OK' : ' NO'}`
              : '-';

            pdf.rect(x, currentY, playerColumnWidth, rowHeight);
            cellText(bidText, x, currentY + 5.2, playerColumnWidth, 'center');
            x += playerColumnWidth;
          });

          currentY += rowHeight;
        });

        currentY += 8;
      });
    };

    drawMainHeader();
    drawSummary();
    drawLeaderboard();
    drawBidTable();

    // Generate filename
    const timestamp = new Date().toISOString().split('T')[0];
    const filename = `${gameName}-${gameCode}-${timestamp}.pdf`;

    // Download PDF
    pdf.save(filename);
  } catch (error) {
    console.error('Error generating PDF:', error);
    throw new Error('Failed to generate PDF report');
  }
}
