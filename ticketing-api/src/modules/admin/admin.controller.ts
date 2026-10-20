import { Controller, Get, HttpCode, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser, Roles, type AuthUser } from '../../common/auth/auth.decorators.js';
import { ApiZodQuery, ApiZodResponse, pageSchema, UuidSchema, zodPipe } from '../../common/validation/zod.js';
import { AdminService, ListManagersQuerySchema, ManagerSummarySchema, type ListManagersQuery } from './admin.service.js';

@ApiTags('admin')
@ApiBearerAuth()
@Roles('ADMIN')
@Controller('admin/managers')
export class AdminController {
  constructor(private readonly admin: AdminService) {}

  @Get()
  @ApiOperation({ summary: 'List manager accounts (filter by status)' })
  @ApiZodQuery(ListManagersQuerySchema)
  @ApiZodResponse(200, pageSchema(ManagerSummarySchema))
  list(@Query(zodPipe(ListManagersQuerySchema)) query: ListManagersQuery) {
    return this.admin.listManagers(query);
  }

  @Post(':id/approve')
  @HttpCode(200)
  @ApiOperation({ summary: 'Approve (or re-activate) a manager' })
  @ApiZodResponse(200, ManagerSummarySchema)
  approve(@CurrentUser() admin: AuthUser, @Param('id', zodPipe(UuidSchema)) id: string) {
    return this.admin.approveManager(admin, id);
  }

  @Post(':id/suspend')
  @HttpCode(200)
  @ApiOperation({ summary: 'Suspend a manager and end their sessions' })
  @ApiZodResponse(200, ManagerSummarySchema)
  suspend(@CurrentUser() admin: AuthUser, @Param('id', zodPipe(UuidSchema)) id: string) {
    return this.admin.suspendManager(admin, id);
  }
}
