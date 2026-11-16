import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsInt,
  IsOptional,
  IsString,
  Length,
  Matches,
  Max,
  Min,
} from 'class-validator';

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

export class QueryProductsDto {
  @IsOptional()
  @IsString()
  category?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit?: number;
}
