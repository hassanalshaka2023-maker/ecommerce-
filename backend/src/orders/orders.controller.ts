import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Auth, type AuthUser, CurrentUser, Role } from '../common/auth.js';
import { PageQueryDto } from '../common/page-query.dto.js';
import { CreateOrderDto, UpdateOrderStatusDto } from './orders.dto.js';
import { OrdersService } from './orders.service.js';

@ApiTags('orders')
@Controller('orders')
export class OrdersController {
  constructor(private readonly orders: OrdersService) {}

  @Post()
  @Auth()
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateOrderDto) {
    return this.orders.create(user.id, dto);
  }

  @Get()
  @Auth()
  findAll(@CurrentUser() user: AuthUser, @Query() query: PageQueryDto) {
    return this.orders.findAll(user, query);
  }

  @Get(':id')
  @Auth()
  findOne(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.orders.findOne(id, user);
  }

  @Patch(':id/status')
  @Auth(Role.ADMIN)
  updateStatus(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateOrderStatusDto,
  ) {
    return this.orders.updateStatus(id, dto.status);
  }
}
