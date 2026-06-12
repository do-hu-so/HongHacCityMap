import { NextResponse } from "next/server";

export async function POST(request) {
  const { id, password } = await request.json();
  
  // Lấy tài khoản và mật khẩu từ biến môi trường để bảo mật, nếu không có sẽ dùng mặc định
  const expectedId = process.env.ADMIN_USERNAME || "admin";
  const expectedPassword = process.env.ADMIN_PASSWORD || "123admin@123";
  
  if (id === expectedId && password === expectedPassword) {
    return NextResponse.json({ success: true });
  }
  return NextResponse.json({ success: false, error: "Sai tài khoản hoặc mật khẩu" }, { status: 401 });
}
