import { NextResponse, type NextRequest } from "next/server";

const COOKIE = "ara_session";
const AUTH_PAGES = ["/login", "/register"];

/**
 * Optimistic route guard (UX only): the API validates the session on every request.
 * (Next 16 renamed the `middleware` convention to `proxy`.)
 */
export function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const hasSession = req.cookies.has(COOKIE);
  const isAuthPage = AUTH_PAGES.some((p) => pathname === p);
  if (!hasSession && !isAuthPage) {
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    url.search = "";
    return NextResponse.redirect(url);
  }
  if (hasSession && isAuthPage) {
    const url = req.nextUrl.clone();
    url.pathname = "/dashboard";
    url.search = "";
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico|.*\\..*).*)"],
};
