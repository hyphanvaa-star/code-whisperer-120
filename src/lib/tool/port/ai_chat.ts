// Port of ai_chat.py — system prompt kept verbatim; board-dump context trimmed
// to the fields the Lovable AI Gateway call needs. Live call lives in
// misc.server.ts (needs LOVABLE_API_KEY).
export const SYSTEM_PROMPT =
  "Bạn là trợ lý ảo đa năng, đồng thời gắn trong Dispatch Board cho dispatcher " +
  "VJC/Vietjet. Trả lời như AI chat thông thường: kiến thức chung, giải thích, " +
  "soạn văn, link, chuyện phiếm.\n" +
  "Không từ chối chỉ vì câu hỏi ngoài hàng không.\n" +
  "Tiếng Việt khi hỏi tiếng Việt. Câu thường: ngắn gọn. Câu cần giải thích: đủ ý.\n" +
  "CẤM markdown: không bọc chữ bằng ** ** hay * * hay __ __, không # tiêu đề, " +
  "không `code`. Viết chữ thường; muốn nhấn thì nói thẳng, không thêm dấu sao.\n";

export type BoardFlight = {
  callsign: string;
  route: string;
  std: string;
  dispatcher: string;
};

/** Dòng bảng board ngắn gọn cho context AI — tương đương ai_board_dump(). */
export function aiBoardDump(flights: BoardFlight[]): string {
  if (!flights.length) return "(không có chuyến nào trong cửa sổ hiện tại)";
  return flights
    .map((f) => `${f.callsign} ${f.route} ${f.std} DSP:${f.dispatcher || "?"}`)
    .join("\n");
}
