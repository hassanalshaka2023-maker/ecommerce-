import { randomUUID } from 'node:crypto';
import { extname } from 'node:path';
import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UnprocessableEntityException,
  UploadedFile,
  UseInterceptors,
  Put,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiConsumes, ApiTags } from '@nestjs/swagger';
import type { Express } from 'express';
import { diskStorage } from 'multer';
import { Auth, Role } from '../common/auth.js';
import {
  CreateProductDto,
  QueryProductsDto,
  SetStockDto,
} from './products.dto.js';
import { ProductsService } from './products.service.js';

const imageUpload = FileInterceptor('image', {
  storage: diskStorage({
    destination: 'uploads/products',
    // Random name: the user's filename is never trusted or used on disk.
    filename: (_req, file, done) =>
      done(null, randomUUID() + extname(file.originalname)),
  }),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, done) =>
    /^image\/(jpeg|png|webp)$/.test(file.mimetype)
      ? done(null, true)
      : done(
          new UnprocessableEntityException('Image must be JPEG, PNG or WEBP'),
          false,
        ),
});

@ApiTags('products')
@Controller('products')
export class ProductsController {
  constructor(private readonly products: ProductsService) {}

  @Post()
  @Auth(Role.ADMIN)
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(imageUpload)
  create(
    @Body() dto: CreateProductDto,
    @UploadedFile() image?: Express.Multer.File,
  ) {
    const imageUrl = image ? `/uploads/products/${image.filename}` : null;
    return this.products.create(dto, imageUrl);
  }

  @Get()
  findAll(@Query() query: QueryProductsDto) {
    return this.products.findAll(query);
  }

  @Get(':id')
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.products.findOne(id);
  }

  @Put(':id/stock')
  @Auth(Role.ADMIN)
  setStock(@Param('id', ParseUUIDPipe) id: string, @Body() dto: SetStockDto) {
    return this.products.setStock(id, dto.quantity);
  }
}
