import { IsEmail, IsString, Length } from 'class-validator';

export class RegisterDto {
  @Length(2, 100)
  name: string;

  @IsEmail()
  email: string;

  @Length(8, 72) // bcrypt ignores everything after 72 bytes
  password: string;
}

export class LoginDto {
  @IsEmail()
  email: string;

  @IsString()
  password: string;
}
