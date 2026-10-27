import { getPermissionSession } from "@/server/auth/authorize";
import { getReport,reportFilters } from "@/server/commerce/service";
export async function GET(request:Request) {
  if(!await getPermissionSession("reports:read"))return new Response("Access denied",{status:403});
  const filters=reportFilters.safeParse(Object.fromEntries(new URL(request.url).searchParams));
  if(!filters.success)return new Response("Invalid dates",{status:400});
  try {
    const report=await getReport(filters.data);
    const csv=["Date (Asia/Manila),Fulfilled orders,Sales PHP",...report.daily.map(d=>`${d.day},${d.orders},${(Number(d.revenue)/100).toFixed(2)}`)].join("\r\n");
    return new Response(csv,{headers:{"Content-Type":"text/csv; charset=utf-8","Content-Disposition":`attachment; filename="sales-${filters.data.start}-${filters.data.end}.csv"`,"Cache-Control":"private, no-store","X-Content-Type-Options":"nosniff"}});
  } catch {return new Response("Unable to export reports. Refresh and retry.",{status:503});}
}
