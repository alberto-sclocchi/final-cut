import { Schema, model, InferSchemaType } from "mongoose";

const userSchema = new Schema(
  {
    name: {
      type: String,
      required: [true, 'Name is required.'],
      trim: true
    },
    username: {
      type: String,
      required: [true, 'Username is required.'],
      unique: true,
      lowercase: true,
      trim: true,
      minlength: [3, 'Username must be at least 3 characters.'],
      maxlength: [30, 'Username must be at most 30 characters.'],
      match: [/^[a-z0-9_.]+$/, 'Username can only contain letters, numbers, dots and underscores.']
    },
    // used to log in
    // unique + lowercase so the same email can't sign up twice
    email: {
      type: String,
      required: [true, 'Email is required.'],
      unique: true,
      lowercase: true,
      trim: true,
      match: [/^\S+@\S+\.\S+$/, 'Please provide a valid email address.']
    },
    // stores the bcrypt HASH, never the plain password.
    password: {
      type: String,
      required: [true, 'Password is required.'],
      select: false
    },
    // what the user is allowed to do. Everyone signs up as "user", admins are set by hand in the db
    role: {
      type: String,
      enum: ["user", "admin"],
      default: "user"
    },
    // movies the user wants to watch. Stores Movie ids, use .populate("watchlist") to get the full movies
    watchlist: {
      type: [{ type: Schema.Types.ObjectId, ref: "Movie" }],
      default: []
    }
  },
  {
    // this second object adds extra properties: `createdAt` and `updatedAt`
    timestamps: true
  }
);

export type IUser = InferSchemaType<typeof userSchema>;

const User = model("User", userSchema);

export default User;
