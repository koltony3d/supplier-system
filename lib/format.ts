export const ils = (v: string | number | null | undefined) =>
  v === null || v === undefined || v === "" ? "" :
  "₪" + Number(v).toLocaleString("he-IL", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export const date = (v: Date | string | null | undefined) => (v ? new Date(v).toLocaleDateString("he-IL") : "");

export const rfqNo = (id: number) => `RFQ-${String(id).padStart(5, "0")}`;

export const RFQ_STATUS: Record<string, string> = {
  draft: "טיוטה", sent: "נשלחה לספק", answered: "התקבלה הצעה", closed: "סגורה", deleted: "נמחקה",
};

export const poNo = (id: number) => `PO-${String(id).padStart(5, "0")}`;

export const PO_STATUS: Record<string, string> = {
  draft: "טיוטה", sent: "נשלחה לספק", partial: "התקבלה חלקית", received: "התקבלה במלואה", cancelled: "בוטלה",
};

export const grNo = (id: number) => `GR-${String(id).padStart(5, "0")}`;
export const qty = (v: string | number | null | undefined) => (v === null || v === undefined ? "" : String(Number(v)));
