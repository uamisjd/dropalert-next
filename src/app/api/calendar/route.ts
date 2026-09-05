/**
 * GET /api/calendar — stato del radar calendario.
 *
 * Esiste per rendere ispezionabile ciò che la pagina mostra: quante partite
 * il calendario conosce e, quando non ne conosce, PERCHÉ. Senza questa
 * risposta un blocco assente è indistinguibile da una fonte spenta.
 */
import { getCalendar } from "@/lib/repo/calendar";

export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  const now = new Date();
  try {
    const view = await getCalendar(0, now);
    return Response.json({
      ok: true,
      count: view.fixtures.length,
      unavailableReason: view.unavailableReason,
      fetchedAt: view.fetchedAt,
      sample: view.fixtures.slice(0, 3),
      keyConfigured: (process.env.FOOTBALL_DATA_API_KEY ?? "").trim() !== "",
    });
  } catch (err) {
    console.error(
      "[api/calendar] lettura calendario fallita:",
      err instanceof Error ? err.message : err,
    );
    return Response.json({
      ok: false,
      error: "Calendario non leggibile in questo momento.",
      keyConfigured: (process.env.FOOTBALL_DATA_API_KEY ?? "").trim() !== "",
    });
  }
}
