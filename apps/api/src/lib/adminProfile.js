// 對外回傳的 admin 欄位（刻意排除 passwordHash 與 JWT 內部欄位）
export function toAdminProfile(admin) {
  return {
    id: admin.id,
    email: admin.email,
    name: admin.name,
    role: admin.role,
  };
}
