import mongoose from "mongoose";

const callSchema = new mongoose.Schema(
  {
    customerName: { type: String, default: "Unknown Lead" },
    email: { type: String, default: "Not provided" },
    phone: { type: String, default: "Not provided" },
    callDateTime: { type: Date, default: Date.now },
    sentiment: {
      type: String,
      enum: ["Positive", "Neutral", "Negative"],
      default: "Neutral",
    },
    leadClassification: {
      type: String,
      enum: ["Hot", "Warm", "Cold"],
      default: "Cold",
    },
    summary: {
      type: [String],
      default: [],
    },
    bookingInfo: {
      demoBooked: { type: Boolean, default: false },
      dateTime: { type: String, default: "Not scheduled" },
    },
    transcript: [
      {
        speaker: { type: String, required: true },
        text: { type: String, required: true },
      },
    ],
  },
  { timestamps: true }
);

export default mongoose.model("Call", callSchema);