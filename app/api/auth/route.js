import { NextResponse } from "next/server";

const CREDENTIALS = { id: "admin", password: "123admin@123" };

export async function POST(request) {
  const { id, password } = await request.json();
  if (id === CREDENTIALS.id && password === CREDENTIALS.password) {
    return NextResponse.json({ success: true });
  }
  return NextResponse.json({ success: false, error: "Sai tài khoản hoặc mật khẩu" }, { status: 401 });
}
