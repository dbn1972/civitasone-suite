/// HR Module — exports all HR feature screens and provides route configuration.
library;

import 'package:go_router/go_router.dart';

import 'attendance_screen.dart';
import 'employees_screen.dart';
import 'leave_screen.dart';
import 'leave_apply_screen.dart';
import 'geo_checkin_screen.dart';
import 'face_verify_screen.dart';
import 'payslip_screen.dart';
import 'dashboard_screen.dart';
import 'leave_balance_screen.dart';
import 'approval_inbox_screen.dart';
import 'profile_photo_screen.dart';

export 'attendance_screen.dart';
export 'employees_screen.dart';
export 'leave_screen.dart';
export 'leave_apply_screen.dart';
export 'geo_checkin_screen.dart';
export 'face_verify_screen.dart';
export 'payslip_screen.dart';
export 'dashboard_screen.dart';
export 'leave_balance_screen.dart';
export 'approval_inbox_screen.dart';
export 'profile_photo_screen.dart';

/// Shell routes — shown inside the bottom-nav AppShell.
List<GoRoute> hrShellRoutes() => [
      GoRoute(
        path: '/hr/dashboard',
        builder: (_, __) => const HrDashboardScreen(),
      ),
      GoRoute(
        path: '/hr/employees',
        builder: (_, __) => const EmployeesScreen(),
      ),
      GoRoute(
        path: '/hr/leave',
        builder: (_, __) => const LeaveScreen(),
      ),
      GoRoute(
        path: '/hr/attendance',
        builder: (_, __) => const AttendanceScreen(),
      ),
      GoRoute(
        path: '/hr/leave-balance',
        builder: (_, __) => const LeaveBalanceScreen(),
      ),
      GoRoute(
        path: '/hr/payslips',
        builder: (_, __) => const PayslipScreen(),
      ),
      GoRoute(
        path: '/hr/approvals',
        builder: (_, __) => const ApprovalInboxScreen(),
      ),
    ];

/// Full-screen routes — rendered outside the shell (no bottom nav).
List<GoRoute> hrFullScreenRoutes() => [
      GoRoute(
        path: '/hr/leave/apply',
        builder: (_, __) => const LeaveApplyScreen(),
      ),
      GoRoute(
        path: '/hr/geo-checkin',
        builder: (_, __) => const GeoCheckinScreen(),
      ),
      GoRoute(
        path: '/hr/face-verify',
        builder: (_, __) => const FaceVerifyScreen(),
      ),
      GoRoute(
        path: '/hr/profile-photo',
        builder: (_, __) => const ProfilePhotoScreen(),
      ),
    ];
