// 기존 import 경로 호환용. 새 코드는 role과 무관한 usePermissions를 사용한다.
export {
  PERMISSIONS_QUERY_KEY as ADMIN_PERMISSIONS_QUERY_KEY,
  usePermissions as useAdminPermissions,
} from "./usePermissions";
