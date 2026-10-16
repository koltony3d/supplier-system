export default function Msg({ sp }: { sp: { msg?: string; err?: string } }) {
  if (sp.err) return <div className="msg err">{sp.err}</div>;
  if (sp.msg) return <div className="msg">{sp.msg}</div>;
  return null;
}
