import { ApiProperty, OmitType, PartialType } from '@nestjs/swagger';
import {
  IsInt,
  IsOptional,
  IsString,
  Length,
  Matches,
  Min,
} from 'class-validator';
import { PageQueryDto } from '../common/page-query.dto.js';

export class CreateProductDto {
  @Length(1, 150)
  name: string;

  @IsOptional()
  @IsString()
  description?: string;

  @Matches(/^\d+(\.\d{1,2})?$/, { message: 'price must look like 49.99' })
  price: string;

  @Length(1, 60)
  category: string;

  // The file itself is read by multer; this only adds the upload field to Swagger.
  @ApiProperty({ type: 'string', format: 'binary', required: false })
  @IsOptional()
  image?: unknown;
}

// Same rules as creating a product, but every field is optional and there is no image.
export class UpdateProductDto extends PartialType(
  OmitType(CreateProductDto, ['image']),
) {}

export class QueryProductsDto extends PageQueryDto {
  @IsOptional()
  @IsString()
  category?: string;
}

export class SetStockDto {
  @IsInt()
  @Min(0)
  quantity: number;
}
